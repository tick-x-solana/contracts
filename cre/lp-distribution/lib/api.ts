// ==========================================================================
// LP Distribution API Client
// ==========================================================================

import type { DistributionBatch } from "../types";

// ========================================
// API Client Interface
// ========================================

export interface LpDistributionApiClient {
  getPendingDistributionBatches(): Promise<DistributionBatch[]>;
  markBatchDistributed(batchId: number, results: DistributionResult[]): Promise<void>;
}

export interface DistributionResult {
  epochId: number;
  destination: {
    chainSelector: number;
    receiver: string;
    amount: string;
  };
  txHash: string;
  status: "success" | "failed";
  error?: string;
}

// ========================================
// Real API Client
// ========================================

export class RealLpDistributionApiClient implements LpDistributionApiClient {
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

  async getPendingDistributionBatches(): Promise<DistributionBatch[]> {
    const data = await this.fetch<{ batches: DistributionBatch[] }>(`/distribution/batches/pending`);
    return data.batches;
  }

  async markBatchDistributed(batchId: number, results: DistributionResult[]): Promise<void> {
    await this.fetch(`/distribution/batches/${batchId}/distributed`, {
      method: "POST",
      body: JSON.stringify({
        results,
        distributedAt: Math.floor(Date.now() / 1000),
      }),
    });
  }
}

// ========================================
// Mock API Client
// ========================================

export class MockLpDistributionApiClient implements LpDistributionApiClient {
  private seededRandom(seed: number): number {
    const x = Math.sin(seed * 9999) * 10000;
    return x - Math.floor(x);
  }

  async getPendingDistributionBatches(): Promise<DistributionBatch[]> {
    const seed = Math.floor(Date.now() / 86400000);

    return [
      {
        epochId: seed,
        totalRewards: (BigInt(Math.floor(this.seededRandom(seed) * 10000)) * BigInt(1e18)).toString(),
        snapshotBlock: 12345678 + Math.floor(this.seededRandom(seed) * 1000),
        lpShares: [
          { lp: "0x1234567890123456789012345678901234567890", shares: "1000000000000000000000" },
          { lp: "0x0987654321098765432109876543210987654321", shares: "500000000000000000000" },
        ],
        destinations: [
          {
            chainSelector: 16015286601757825753, // Sepolia
            receiver: "0x1234567890123456789012345678901234567890",
            amount: "5000000000000000000000",
          },
          {
            chainSelector: 14767482510784806043, // Base Sepolia
            receiver: "0x0987654321098765432109876543210987654321",
            amount: "3000000000000000000000",
          },
        ],
      },
    ];
  }

  async markBatchDistributed(batchId: number, results: DistributionResult[]): Promise<void> {
    console.log(`[Mock] Batch ${batchId} marked distributed with ${results.length} results`);
    // No-op in mock
  }
}

// ========================================
// Factory
// ========================================

export const createApiClient = (baseUrl: string, apiKey: string, useMock = false): LpDistributionApiClient => {
  if (useMock || baseUrl.includes("localhost")) {
    return new MockLpDistributionApiClient();
  }
  return new RealLpDistributionApiClient(baseUrl, apiKey);
};
