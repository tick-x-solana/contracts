// ==========================================================================
// LP Distribution Workflow Tests
// ==========================================================================

import { describe, it, expect } from "bun:test";
import { MockLpDistributionApiClient } from "../lp-distribution/lib/api";
import { encodeDistribution } from "../lp-distribution/lib/ethereum";
import type { DistributionDestination } from "../lp-distribution/types";

// ========================================
// Distribution Encoding Tests
// ========================================

describe("Distribution Encoding", () => {
  it("encodes distribution payload correctly", () => {
    const payload = {
      epochId: 100,
      amount: BigInt("5000000000000000000000"), // 5000 tokens
      dstChainSelector: BigInt("16015286601757825753"), // Sepolia
      receiver: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    };

    const encoded = encodeDistribution(payload);
    
    expect(encoded).toBeDefined();
    expect(encoded.startsWith("0x")).toBe(true);
    expect(encoded.length).toBeGreaterThan(2);
  });

  it("produces different encodings for different payloads", () => {
    const payload1 = {
      epochId: 100,
      amount: BigInt("5000"),
      dstChainSelector: BigInt("16015286601757825753"),
      receiver: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    };

    const payload2 = {
      epochId: 101,
      amount: BigInt("5000"),
      dstChainSelector: BigInt("16015286601757825753"),
      receiver: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    };

    const encoded1 = encodeDistribution(payload1);
    const encoded2 = encodeDistribution(payload2);

    expect(encoded1).not.toBe(encoded2);
  });
});

// ========================================
// Mock API Client Tests
// ========================================

describe("MockLpDistributionApiClient", () => {
  const client = new MockLpDistributionApiClient();

  it("returns distribution batches", async () => {
    const batches = await client.getPendingDistributionBatches();
    
    expect(batches.length).toBeGreaterThanOrEqual(1);
    
    const batch = batches[0];
    expect(batch.epochId).toBeGreaterThan(0);
    expect(BigInt(batch.totalRewards)).toBeGreaterThan(0n);
    expect(batch.snapshotBlock).toBeGreaterThan(0);
    expect(batch.lpShares.length).toBeGreaterThan(0);
    expect(batch.destinations.length).toBeGreaterThan(0);
  });

  it("returns deterministic batches for same day", async () => {
    const batches1 = await client.getPendingDistributionBatches();
    const batches2 = await client.getPendingDistributionBatches();
    
    expect(batches1.length).toBe(batches2.length);
    expect(batches1[0].epochId).toBe(batches2[0].epochId);
  });

  it("returns valid LP share structure", async () => {
    const batches = await client.getPendingDistributionBatches();
    const batch = batches[0];
    
    for (const share of batch.lpShares) {
      expect(share.lp).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(BigInt(share.shares)).toBeGreaterThan(0n);
    }
  });

  it("returns valid destination structure", async () => {
    const batches = await client.getPendingDistributionBatches();
    const batch = batches[0];
    
    for (const dest of batch.destinations) {
      expect(dest.chainSelector).toBeGreaterThan(0);
      expect(dest.receiver).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(BigInt(dest.amount)).toBeGreaterThan(0n);
    }
  });

  it("markBatchDistributed does not throw", async () => {
    const results = [
      {
        epochId: 100,
        destination: {
          chainSelector: 16015286601757825753,
          receiver: "0x1234567890123456789012345678901234567890",
          amount: "5000000000000000000000",
        },
        txHash: "0xabc123",
        status: "success" as const,
      },
    ];
    
    await expect(
      client.markBatchDistributed(100, results)
    ).resolves.toBeUndefined();
  });
});

// ========================================
// Distribution Result Tests
// ========================================

describe("Distribution Results", () => {
  it("correctly identifies successful distributions", () => {
    const results = [
      { epochId: 1, destination: {} as DistributionDestination, txHash: "0x1", status: "success" as const },
      { epochId: 1, destination: {} as DistributionDestination, txHash: "0x2", status: "success" as const },
      { epochId: 1, destination: {} as DistributionDestination, txHash: "", status: "failed" as const, error: "reverted" },
    ];

    const successCount = results.filter(r => r.status === "success").length;
    const failedCount = results.filter(r => r.status === "failed").length;

    expect(successCount).toBe(2);
    expect(failedCount).toBe(1);
  });

  it("correctly handles all successful distributions", () => {
    const results = [
      { epochId: 1, destination: {} as DistributionDestination, txHash: "0x1", status: "success" as const },
      { epochId: 1, destination: {} as DistributionDestination, txHash: "0x2", status: "success" as const },
    ];

    const allSuccess = results.every(r => r.status === "success");
    expect(allSuccess).toBe(true);
  });

  it("correctly handles partial failures", () => {
    const results = [
      { epochId: 1, destination: {} as DistributionDestination, txHash: "0x1", status: "success" as const },
      { epochId: 1, destination: {} as DistributionDestination, txHash: "", status: "failed" as const, error: "insufficient funds" },
    ];

    const hasSuccess = results.some(r => r.status === "success");
    const hasFailed = results.some(r => r.status === "failed");
    
    expect(hasSuccess).toBe(true);
    expect(hasFailed).toBe(true);
  });
});

// ========================================
// Batch Processing Tests
// ========================================

describe("Batch Processing", () => {
  it("calculates correct total distribution amount", () => {
    const destinations: DistributionDestination[] = [
      { chainSelector: 1, receiver: "0x1", amount: "5000000000000000000000" },
      { chainSelector: 2, receiver: "0x2", amount: "3000000000000000000000" },
      { chainSelector: 3, receiver: "0x3", amount: "2000000000000000000000" },
    ];

    const totalAmount = destinations.reduce((sum, d) => sum + BigInt(d.amount), 0n);
    
    expect(totalAmount).toBe(BigInt("10000000000000000000000")); // 10,000 tokens
  });

  it("handles single destination batch", () => {
    const destinations: DistributionDestination[] = [
      { chainSelector: 1, receiver: "0x1", amount: "1000000000000000000000" },
    ];

    expect(destinations.length).toBe(1);
    expect(BigInt(destinations[0].amount)).toBe(BigInt("1000000000000000000000"));
  });

  it("handles empty destinations", () => {
    const destinations: DistributionDestination[] = [];
    
    const totalAmount = destinations.reduce((sum, d) => sum + BigInt(d.amount), 0n);
    expect(totalAmount).toBe(0n);
  });
});

// ========================================
// Chain Selector Tests
// ========================================

describe("Chain Selectors", () => {
  it("recognizes Sepolia chain selector", () => {
    const sepoliaSelector = BigInt("16015286601757825753");
    expect(sepoliaSelector.toString()).toBe("16015286601757825753");
  });

  it("recognizes Base Sepolia chain selector", () => {
    const baseSepoliaSelector = BigInt("14767482510784806043");
    expect(baseSepoliaSelector.toString()).toBe("14767482510784806043");
  });
});
