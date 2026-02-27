// ==========================================================================
// App API Client for Tap.fun CRE Workflows
// Includes mock implementations for testing
// ==========================================================================

import { 
  OhlcResponse, 
  SettlementBatch, 
  LiabilityResponse, 
  DistributionBatch, 
  StrategyRegime,
  ohlcResponseSchema,
  settlementBatchSchema,
  liabilityResponseSchema,
  distributionBatchSchema,
  strategyRegimeSchema,
} from "../types";

// ========================================
// API Client Interface
// ========================================

export interface AppApiClient {
  // Price Integrity APIs
  getOhlcCandles(windowStart: number, windowEnd: number, source: "internal" | "chainlink"): Promise<OhlcResponse>;
  
  // Settlement APIs
  getPendingSettlementBatches(windowStart: number, windowEnd: number): Promise<SettlementBatch[]>;
  markBatchCommitted(batchId: string, txHash: string, merkleRoot: string): Promise<void>;
  
  // Pool Solvency APIs
  getLiabilityData(): Promise<LiabilityResponse>;
  
  // LP Distribution APIs
  getPendingDistributionBatches(): Promise<DistributionBatch[]>;
  
  // Strategy APIs
  getCurrentStrategyRegime(): Promise<StrategyRegime>;
}

// ========================================
// Real API Client
// ========================================

export class RealAppApiClient implements AppApiClient {
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

  async getOhlcCandles(windowStart: number, windowEnd: number, source: "internal" | "chainlink"): Promise<OhlcResponse> {
    const data = await this.fetch<OhlcResponse>(
      `/ohlc?windowStart=${windowStart}&windowEnd=${windowEnd}&source=${source}`
    );
    return ohlcResponseSchema.parse(data);
  }

  async getPendingSettlementBatches(windowStart: number, windowEnd: number): Promise<SettlementBatch[]> {
    const data = await this.fetch<{ batches: SettlementBatch[] }>(
      `/settlement/batches/pending?windowStart=${windowStart}&windowEnd=${windowEnd}`
    );
    return data.batches.map(b => settlementBatchSchema.parse(b));
  }

  async markBatchCommitted(batchId: string, txHash: string, merkleRoot: string): Promise<void> {
    await this.fetch(`/settlement/batches/${batchId}/committed`, {
      method: "POST",
      body: JSON.stringify({ txHash, merkleRoot, committedAt: Math.floor(Date.now() / 1000) }),
    });
  }

  async getLiabilityData(): Promise<LiabilityResponse> {
    const data = await this.fetch<LiabilityResponse>(`/risk/liability`);
    return liabilityResponseSchema.parse(data);
  }

  async getPendingDistributionBatches(): Promise<DistributionBatch[]> {
    const data = await this.fetch<{ batches: DistributionBatch[] }>(`/distribution/batches/pending`);
    return data.batches.map(b => distributionBatchSchema.parse(b));
  }

  async getCurrentStrategyRegime(): Promise<StrategyRegime> {
    const data = await this.fetch<StrategyRegime>(`/strategy/current`);
    return strategyRegimeSchema.parse(data);
  }
}

// ========================================
// Mock API Client (for testing)
// ========================================

export class MockAppApiClient implements AppApiClient {
  // Configuration for mock behavior
  public matchRate = 1.0; // 0.0 - 1.0, affects price integrity matching
  public winRate = 0.7;   // 0.0 - 1.0, affects settlement outcomes

  // Deterministic pseudo-random based on seed
  private seededRandom(seed: number): number {
    const x = Math.sin(seed * 9999) * 10000;
    return x - Math.floor(x);
  }

  private generateCandles(windowStart: number, count: number, basePrice: number): OhlcResponse["candles"] {
    const candles: OhlcResponse["candles"] = [];
    let currentPrice = basePrice;

    for (let i = 0; i < count; i++) {
      const timestamp = windowStart + i;
      const seed = timestamp;
      const volatility = 0.001; // 0.1% volatility
      
      const change = (this.seededRandom(seed) - 0.5) * 2 * volatility;
      const open = currentPrice;
      const close = currentPrice * (1 + change);
      const high = Math.max(open, close) * (1 + Math.abs(this.seededRandom(seed + 1)) * volatility * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(this.seededRandom(seed + 2)) * volatility * 0.5);

      candles.push({
        timestamp,
        open: open.toFixed(2),
        high: high.toFixed(2),
        low: low.toFixed(2),
        close: close.toFixed(2),
      });

      currentPrice = close;
    }

    return candles;
  }

  async getOhlcCandles(windowStart: number, windowEnd: number, source: "internal" | "chainlink"): Promise<OhlcResponse> {
    const count = windowEnd - windowStart;
    const basePrice = 96240.50;
    
    // Generate internal candles
    const internalCandles = this.generateCandles(windowStart, count, basePrice);
    
    // Generate Chainlink candles with some deviation based on matchRate
    const chainlinkCandles = internalCandles.map(c => {
      if (this.matchRate >= 1.0) return c;
      
      const deviation = (1 - this.matchRate) * 0.01; // Up to 1% deviation
      const seed = parseInt(c.timestamp.toString()) + source.length;
      const factor = 1 + (this.seededRandom(seed) - 0.5) * 2 * deviation;
      
      return {
        timestamp: c.timestamp,
        open: (parseFloat(c.open) * factor).toFixed(2),
        high: (parseFloat(c.high) * factor).toFixed(2),
        low: (parseFloat(c.low) * factor).toFixed(2),
        close: (parseFloat(c.close) * factor).toFixed(2),
      };
    });

    const candles = source === "internal" ? internalCandles : chainlinkCandles;
    
    // Compute hash
    const { keccak256, toHex } = await import("viem");
    const hash = keccak256(toHex(JSON.stringify(candles)));

    return {
      windowStart,
      windowEnd,
      candles,
      count,
      hash,
    };
  }

  async getPendingSettlementBatches(windowStart: number, windowEnd: number): Promise<SettlementBatch[]> {
    const seed = windowStart;
    const batchCount = Math.floor(this.seededRandom(seed) * 3) + 1; // 1-3 batches
    
    return Array.from({ length: batchCount }, (_, i) => {
      const batchSeed = seed + i;
      const account = `0x${Array.from({ length: 40 }, (_, j) => 
        Math.floor(this.seededRandom(batchSeed + j) * 16).toString(16)
      ).join("")}` as `0x${string}`;

      return {
        batchId: `batch_${windowStart}_${i}`,
        windowStart,
        windowEnd,
        deposits: [
          { account, amount: "1000000000000000000" },
        ],
        withdrawals: [],
        settlements: [
          {
            account,
            betId: `bet_${batchSeed}`,
            outcome: this.seededRandom(batchSeed + 100) < this.winRate ? "WIN" : "LOSE",
            payout: "2000000000000000000",
            originalStake: "1000000000000000000",
          },
        ],
      };
    });
  }

  async markBatchCommitted(batchId: string, txHash: string, merkleRoot: string): Promise<void> {
    console.log(`[Mock] Batch ${batchId} marked committed with tx ${txHash}`);
    // No-op in mock
  }

  async getLiabilityData(): Promise<LiabilityResponse> {
    const seed = Math.floor(Date.now() / 86400000); // Daily seed
    
    return {
      timestamp: Math.floor(Date.now() / 1000),
      totalLiability: (BigInt(Math.floor(this.seededRandom(seed) * 50000)) * BigInt(1e18)).toString(),
      utilizationBps: Math.floor(this.seededRandom(seed + 1) * 1000) + 500, // 5-15%
      maxSingleBetExposure: (BigInt(Math.floor(this.seededRandom(seed + 2) * 5000)) * BigInt(1e18)).toString(),
      outstandingBets: Math.floor(this.seededRandom(seed + 3) * 100) + 50,
    };
  }

  async getPendingDistributionBatches(): Promise<DistributionBatch[]> {
    const seed = Math.floor(Date.now() / 86400000);
    
    return [
      {
        epochId: Math.floor(Date.now() / 86400000),
        totalRewards: (BigInt(Math.floor(this.seededRandom(seed) * 10000)) * BigInt(1e18)).toString(),
        snapshotBlock: 12345678 + Math.floor(this.seededRandom(seed) * 1000),
        lpShares: [
          { lp: "0x1234567890123456789012345678901234567890" as `0x${string}`, shares: "1000000000000000000000" },
          { lp: "0x0987654321098765432109876543210987654321" as `0x${string}`, shares: "500000000000000000000" },
        ],
        destinations: [
          {
            chainSelector: 16015286601757825753,
            receiver: "0x1234567890123456789012345678901234567890" as `0x${string}`,
            amount: "5000000000000000000000",
          },
        ],
      },
    ];
  }

  async getCurrentStrategyRegime(): Promise<StrategyRegime> {
    const seed = Math.floor(Date.now() / 3600000); // Hourly rotation
    const regimeId = Math.floor(this.seededRandom(seed) * 3) + 1;
    
    const regimes: Record<number, StrategyRegime> = {
      1: {
        regimeId: 1,
        fortressSpreadBps: 100,
        maxMultiplier: 100,
        effectiveTs: Math.floor(Date.now() / 1000),
        volatilityIndex: "0.25",
        regimeName: "LOW_VOL",
      },
      2: {
        regimeId: 2,
        fortressSpreadBps: 150,
        maxMultiplier: 80,
        effectiveTs: Math.floor(Date.now() / 1000),
        volatilityIndex: "0.45",
        regimeName: "NORMAL",
      },
      3: {
        regimeId: 3,
        fortressSpreadBps: 300,
        maxMultiplier: 50,
        effectiveTs: Math.floor(Date.now() / 1000),
        volatilityIndex: "0.75",
        regimeName: "HIGH_VOL",
      },
    };

    return regimes[regimeId];
  }
}

// ========================================
// Factory
// ========================================

export const createApiClient = (baseUrl: string, apiKey: string, useMock = false): AppApiClient => {
  if (useMock || baseUrl.includes("localhost")) {
    return new MockAppApiClient();
  }
  return new RealAppApiClient(baseUrl, apiKey);
};
