// ==========================================================================
// Settlement API Client
// ==========================================================================

import type { SettlementBatch } from "../types";

// ========================================
// API Client Interface
// ========================================

export interface SettlementApiClient {
  getPendingSettlementBatches(windowStart: number, windowEnd: number): Promise<SettlementBatch[]>;
  markBatchCommitted(batchId: string, txHash: string, merkleRoot: string): Promise<void>;
}

// ========================================
// Real API Client
// ========================================

export class RealSettlementApiClient implements SettlementApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText })) as { message: string };
      throw new Error(`API error: ${response.status} - ${error.message}`);
    }

    return response.json() as Promise<T>;
  }

  async getPendingSettlementBatches(windowStart: number, windowEnd: number): Promise<SettlementBatch[]> {
    const data = await this.fetch<{ batches: SettlementBatch[] }>(
      `/settlement/batches/pending?windowStart=${windowStart}&windowEnd=${windowEnd}`
    );
    return data.batches;
  }

  async markBatchCommitted(batchId: string, txHash: string, merkleRoot: string): Promise<void> {
    await this.fetch(`/settlement/batches/${batchId}/committed`, {
      method: "POST",
      body: JSON.stringify({
        txHash,
        merkleRoot,
        committedAt: Math.floor(Date.now() / 1000),
      }),
    });
  }
}

// ========================================
// Mock API Client
// ========================================

export class MockSettlementApiClient implements SettlementApiClient {
  public winRate = 0.7; // 0.0 - 1.0

  private seededRandom(seed: number): number {
    const x = Math.sin(seed * 9999) * 10000;
    return x - Math.floor(x);
  }

  async getPendingSettlementBatches(windowStart: number, windowEnd: number): Promise<SettlementBatch[]> {
    const seed = windowStart;
    const batchCount = Math.floor(this.seededRandom(seed) * 3) + 1; // 1-3 batches

    return Array.from({ length: batchCount }, (_, i) => {
      const batchSeed = seed + i;
      const account = `0x${Array.from({ length: 40 }, (_, j) =>
        Math.floor(this.seededRandom(batchSeed + j) * 16).toString(16)
      ).join("")}` as `0x${string}`;

      const settlementCount = Math.floor(this.seededRandom(batchSeed + 100) * 5) + 1;
      const settlements = Array.from({ length: settlementCount }, (_, j) => ({
        account,
        betId: `bet_${batchSeed}_${j}`,
        outcome: this.seededRandom(batchSeed + j + 200) < this.winRate ? "WIN" as const : "LOSE" as const,
        payout: "2000000000000000000", // 2 ETH
        originalStake: "1000000000000000000", // 1 ETH
      }));

      return {
        batchId: `batch_${windowStart}_${i}`,
        windowStart,
        windowEnd,
        deposits: [
          { account, amount: "1000000000000000000" },
        ],
        withdrawals: [],
        settlements,
      };
    });
  }

  async markBatchCommitted(batchId: string, txHash: string, merkleRoot: string): Promise<void> {
    console.log(`[Mock] Batch ${batchId} marked committed with tx ${txHash}`);
    // No-op in mock
  }
}

// ========================================
// Factory
// ========================================

export const createApiClient = (baseUrl: string, apiKey: string, useMock = false): SettlementApiClient => {
  if (useMock || baseUrl.includes("localhost")) {
    return new MockSettlementApiClient();
  }
  return new RealSettlementApiClient(baseUrl, apiKey);
};
