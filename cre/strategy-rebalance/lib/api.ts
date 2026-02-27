// ==========================================================================
// Strategy Rebalance API Client
// ==========================================================================

// ========================================
// API Client Interface
// ========================================

export interface StrategyApiClient {
  validateApiKey(apiKey: string): Promise<boolean>;
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

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const result = await this.fetch<{ valid: boolean }>(`/auth/validate`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
      return result.valid;
    } catch {
      return false;
    }
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
  private validApiKeys = new Set(["test-api-key", "admin-key", "strategist-key"]);

  async validateApiKey(apiKey: string): Promise<boolean> {
    return this.validApiKeys.has(apiKey);
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
  if (useMock || baseUrl.includes("localhost")) {
    return new MockStrategyApiClient();
  }
  return new RealStrategyApiClient(baseUrl, apiKey);
};
