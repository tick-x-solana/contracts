// ==========================================================================
// Settlement Workflow Tests
// ==========================================================================

import { describe, it, expect } from "bun:test";
import { hashSettlement, computeMerkleRoot, hashSettlementBatch } from "../settlement/lib/hash";
import { MockSettlementApiClient } from "../settlement/lib/api";
import type { Settlement, SettlementBatch } from "../settlement/types";

// ========================================
// Hash Tests
// ========================================

describe("Settlement Hash Functions", () => {
  const mockSettlement: Settlement = {
    account: "0x1234567890123456789012345678901234567890",
    betId: "bet_001",
    outcome: "WIN",
    payout: "2000000000000000000",
    originalStake: "1000000000000000000",
  };

  it("hashSettlement produces deterministic output", () => {
    const hash1 = hashSettlement(mockSettlement);
    const hash2 = hashSettlement(mockSettlement);
    expect(hash1).toBe(hash2);
    expect(hash1.startsWith("0x")).toBe(true);
    expect(hash1.length).toBe(66); // 0x + 64 hex chars
  });

  it("hashSettlement produces different hashes for different settlements", () => {
    const hash1 = hashSettlement(mockSettlement);
    const differentSettlement = { ...mockSettlement, outcome: "LOSE" as const };
    const hash2 = hashSettlement(differentSettlement);
    expect(hash1).not.toBe(hash2);
  });

  it("computeMerkleRoot produces valid root for single leaf", () => {
    const leaf = hashSettlement(mockSettlement);
    const root = computeMerkleRoot([leaf]);
    expect(root.startsWith("0x")).toBe(true);
    expect(root.length).toBe(66);
  });

  it("computeMerkleRoot produces valid root for multiple leaves", () => {
    const leaves = [
      hashSettlement(mockSettlement),
      hashSettlement({ ...mockSettlement, betId: "bet_002" }),
      hashSettlement({ ...mockSettlement, betId: "bet_003" }),
    ];
    const root = computeMerkleRoot(leaves);
    expect(root.startsWith("0x")).toBe(true);
    expect(root.length).toBe(66);
  });

  it("computeMerkleRoot produces same root for same leaves in any order", () => {
    const settlement1 = { ...mockSettlement, betId: "bet_001" };
    const settlement2 = { ...mockSettlement, betId: "bet_002" };
    
    // The implementation sorts leaves, so order shouldn't matter
    const leaves1 = [hashSettlement(settlement1), hashSettlement(settlement2)];
    const leaves2 = [hashSettlement(settlement2), hashSettlement(settlement1)];
    
    // Note: The hashSettlement sorts by account, not by hash, so this test
    // verifies that leaves are sorted deterministically
    const root1 = computeMerkleRoot(leaves1);
    const root2 = computeMerkleRoot(leaves2);
    
    // The leaves array is passed as-is to computeMerkleRoot, which sorts them
    // internally, so roots should be the same
    expect(root1).toBe(root2);
  });

  it("hashSettlementBatch produces deterministic output", () => {
    const batch: SettlementBatch = {
      batchId: "batch_001",
      windowStart: 1000,
      windowEnd: 2000,
      deposits: [],
      withdrawals: [],
      settlements: [mockSettlement],
    };
    
    const hash1 = hashSettlementBatch(batch);
    const hash2 = hashSettlementBatch(batch);
    expect(hash1).toBe(hash2);
  });
});

// ========================================
// Mock API Client Tests
// ========================================

describe("MockSettlementApiClient", () => {
  const client = new MockSettlementApiClient();

  it("getPendingSettlementBatches returns batches", async () => {
    const batches = await client.getPendingSettlementBatches(1000, 2000);
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.length).toBeLessThanOrEqual(3);
  });

  it("getPendingSettlementBatches returns deterministic batches for same window", async () => {
    const batches1 = await client.getPendingSettlementBatches(1000, 2000);
    const batches2 = await client.getPendingSettlementBatches(1000, 2000);
    expect(batches1.length).toBe(batches2.length);
    expect(batches1[0].batchId).toBe(batches2[0].batchId);
  });

  it("getPendingSettlementBatches returns different batches for different windows", async () => {
    const batches1 = await client.getPendingSettlementBatches(1000, 2000);
    const batches2 = await client.getPendingSettlementBatches(2000, 3000);
    expect(batches1[0].batchId).not.toBe(batches2[0].batchId);
  });

  it("getPendingSettlementBatches returns valid settlement structure", async () => {
    const batches = await client.getPendingSettlementBatches(1000, 2000);
    const batch = batches[0];
    
    expect(batch.batchId).toBeDefined();
    expect(batch.windowStart).toBe(1000);
    expect(batch.windowEnd).toBe(2000);
    expect(batch.settlements.length).toBeGreaterThan(0);
    
    const settlement = batch.settlements[0];
    expect(settlement.account).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(settlement.betId).toBeDefined();
    expect(["WIN", "LOSE", "DRAW", "CANCELLED"]).toContain(settlement.outcome);
    expect(BigInt(settlement.payout)).toBeGreaterThan(0);
  });

  it("markBatchCommitted does not throw", async () => {
    await expect(
      client.markBatchCommitted("batch_001", "0xabc123", "0xdef456")
    ).resolves.toBeUndefined();
  });

  it("winRate affects settlement outcomes", async () => {
    const clientWithHighWinRate = new MockSettlementApiClient();
    clientWithHighWinRate.winRate = 1.0; // Always win
    
    const clientWithLowWinRate = new MockSettlementApiClient();
    clientWithLowWinRate.winRate = 0.0; // Always lose
    
    const batchesHigh = await clientWithHighWinRate.getPendingSettlementBatches(1000, 2000);
    const batchesLow = await clientWithLowWinRate.getPendingSettlementBatches(1000, 2000);
    
    // With high win rate, most outcomes should be WIN
    const highWinCount = batchesHigh[0].settlements.filter(s => s.outcome === "WIN").length;
    const lowWinCount = batchesLow[0].settlements.filter(s => s.outcome === "WIN").length;
    
    expect(highWinCount).toBe(batchesHigh[0].settlements.length);
    expect(lowWinCount).toBe(0);
  });
});

// ========================================
// Financial Computation Tests
// ========================================

describe("Financial Computations", () => {
  const createBatch = (settlements: Settlement[]): SettlementBatch => ({
    batchId: "batch_test",
    windowStart: 1000,
    windowEnd: 2000,
    deposits: [],
    withdrawals: [],
    settlements,
  });

  it("computes total payout correctly for WIN outcomes", () => {
    const batch = createBatch([
      { account: "0x1", betId: "1", outcome: "WIN", payout: "2000", originalStake: "1000" },
      { account: "0x2", betId: "2", outcome: "LOSE", payout: "0", originalStake: "1000" },
      { account: "0x3", betId: "3", outcome: "WIN", payout: "3000", originalStake: "1500" },
    ]);

    const totalPayout = batch.settlements.reduce((total, s) => {
      return s.outcome === "WIN" ? total + BigInt(s.payout) : total;
    }, 0n);

    expect(totalPayout).toBe(5000n);
  });

  it("computes withdrawable cap as max payout", () => {
    const batch = createBatch([
      { account: "0x1", betId: "1", outcome: "WIN", payout: "2000", originalStake: "1000" },
      { account: "0x2", betId: "2", outcome: "WIN", payout: "5000", originalStake: "2500" },
      { account: "0x3", betId: "3", outcome: "WIN", payout: "3000", originalStake: "1500" },
    ]);

    const withdrawableCap = batch.settlements.reduce((max, s) => {
      const payout = BigInt(s.payout);
      return payout > max ? payout : max;
    }, 0n);

    expect(withdrawableCap).toBe(5000n);
  });
});
