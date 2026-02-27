// ==========================================================================
// Strategy Rebalance API Client
// ==========================================================================

import type { VolatilityRegime } from "../types";

// ========================================
// API Client Interface
// ========================================

export interface StrategyApiClient {
  getCurrentStrategyRegime(): Promise<VolatilityRegime>;
  logStrategyUpdate(regimeId: number, fortressSpreadBps: number, maxMultiplier: number, txHash: string): Promise<void>;
}

// ========================================
// Real API Client
// ========================================

export class RealStrategyApiClient implements StrategyApiClient {
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

  async getCurrentStrategyRegime(): Promise<VolatilityRegime> {
    return this.fetch<VolatilityRegime>(`/strategy/current`);
  }

  async logStrategyUpdate(
    regimeId: number,
    fortressSpreadBps: number,
    maxMultiplier: number,
    txHash: string
  ): Promise<void> {
    await this.fetch(`/strategy/updates`, {
      method: "POST",
      body: JSON.stringify({
        regimeId,
        fortressSpreadBps,
        maxMultiplier,
        txHash,
        timestamp: Math.floor(Date.now() / 1000),
      }),
    });
  }
}

// ========================================
// Mock API Client
// ========================================

export class MockStrategyApiClient implements StrategyApiClient {
  private seededRandom(seed: number): number {
    const x = Math.sin(seed * 9999) * 10000;
    return x - Math.floor(x);
  }

  async getCurrentStrategyRegime(): Promise<VolatilityRegime> {
    const seed = Math.floor(Date.now() / 3600000); // Hourly rotation
    const regimeId = Math.floor(this.seededRandom(seed) * 3) + 1;
    
    const regimes: Record<number, VolatilityRegime> = {
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

  async logStrategyUpdate(
    regimeId: number,
    fortressSpreadBps: number,
    maxMultiplier: number,
    txHash: string
  ): Promise<void> {
    console.log(`[Mock] Strategy update logged: regime=${regimeId}, spread=${fortressSpreadBps}, multiplier=${maxMultiplier}, tx=${txHash}`);
    // No-op in mock
  }
}

// ========================================
// Factory
// ========================================

export const createApiClient = (baseUrl: string, apiKey: string, useMock = false): StrategyApiClient => {
  // Always use mock in CRE WASM environment (fetch not available)
  // In production deployment, this would use the CRE HTTP capability
  if (useMock || baseUrl.includes("localhost") || typeof fetch === "undefined") {
    return new MockStrategyApiClient();
  }
  return new RealStrategyApiClient(baseUrl, apiKey);
};
