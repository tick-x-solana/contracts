// ==========================================================================
// Strategy Rebalance Workflow Tests
// ==========================================================================

import { describe, it, expect } from "bun:test";
import { MockStrategyApiClient } from "../strategy-rebalance/lib/api";
import { encodeStrategyUpdate } from "../strategy-rebalance/lib/ethereum";
import { strategyUpdateRequestSchema, VALIDATION } from "../strategy-rebalance/types";

// ========================================
// Strategy Update Encoding Tests
// ========================================

describe("Strategy Update Encoding", () => {
  it("encodes strategy update payload correctly", () => {
    const payload = {
      regimeId: 1,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
    };

    const encoded = encodeStrategyUpdate(payload);
    
    expect(encoded).toBeDefined();
    expect(encoded.startsWith("0x")).toBe(true);
    expect(encoded.length).toBeGreaterThan(2);
  });

  it("produces different encodings for different payloads", () => {
    const payload1 = {
      regimeId: 1,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
    };

    const payload2 = {
      regimeId: 2,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
    };

    const encoded1 = encodeStrategyUpdate(payload1);
    const encoded2 = encodeStrategyUpdate(payload2);

    expect(encoded1).not.toBe(encoded2);
  });

  it("encodes large values correctly", () => {
    const payload = {
      regimeId: 999999,
      fortressSpreadBps: 10000,
      maxMultiplier: 1000,
    };

    const encoded = encodeStrategyUpdate(payload);
    expect(encoded).toBeDefined();
    expect(encoded.startsWith("0x")).toBe(true);
  });
});

// ========================================
// Request Validation Tests
// ========================================

describe("Request Validation", () => {
  it("validates correct request", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects negative regimeId", () => {
    const data = {
      regimeId: -1,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects fortressSpreadBps > 10000", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: 10001,
      maxMultiplier: 100,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects maxMultiplier > 1000", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: 100,
      maxMultiplier: 1001,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects zero fortressSpreadBps", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: 0,
      maxMultiplier: 100,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("rejects zero maxMultiplier", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: 100,
      maxMultiplier: 0,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("accepts valid boundary values", () => {
    const data = {
      regimeId: 1,
      fortressSpreadBps: VALIDATION.MAX_FORTRESS_SPREAD_BPS,
      maxMultiplier: VALIDATION.MAX_MAX_MULTIPLIER,
      apiKey: "test-key",
    };

    const result = strategyUpdateRequestSchema.safeParse(data);
    expect(result.success).toBe(true);
  });
});

// ========================================
// Mock API Client Tests
// ========================================

describe("MockStrategyApiClient", () => {
  const client = new MockStrategyApiClient();

  it("validates correct API key", async () => {
    const isValid = await client.validateApiKey("test-api-key");
    expect(isValid).toBe(true);
  });

  it("rejects invalid API key", async () => {
    const isValid = await client.validateApiKey("invalid-key");
    expect(isValid).toBe(false);
  });

  it("rejects empty API key", async () => {
    const isValid = await client.validateApiKey("");
    expect(isValid).toBe(false);
  });

  it("validates multiple valid API keys", async () => {
    const keys = ["test-api-key", "admin-key", "strategist-key"];
    
    for (const key of keys) {
      const isValid = await client.validateApiKey(key);
      expect(isValid).toBe(true);
    }
  });

  it("logStrategyUpdate does not throw", async () => {
    await expect(
      client.logStrategyUpdate(1, 100, 100, "0xabc123")
    ).resolves.toBeUndefined();
  });
});

// ========================================
// No-Op Detection Tests
// ========================================

describe("No-Op Detection", () => {
  const currentRegime = {
    regimeId: 1,
    fortressSpreadBps: 100,
    maxMultiplier: 100,
  };

  it("detects no-op when parameters match", () => {
    const request = {
      regimeId: 2,
      fortressSpreadBps: 100,
      maxMultiplier: 100,
      apiKey: "test-key",
    };

    const isNoOp = 
      currentRegime.fortressSpreadBps === request.fortressSpreadBps &&
      currentRegime.maxMultiplier === request.maxMultiplier;

    expect(isNoOp).toBe(true);
  });

  it("detects change when spread differs", () => {
    const request = {
      regimeId: 2,
      fortressSpreadBps: 150,
      maxMultiplier: 100,
      apiKey: "test-key",
    };

    const isNoOp = 
      currentRegime.fortressSpreadBps === request.fortressSpreadBps &&
      currentRegime.maxMultiplier === request.maxMultiplier;

    expect(isNoOp).toBe(false);
  });

  it("detects change when multiplier differs", () => {
    const request = {
      regimeId: 2,
      fortressSpreadBps: 100,
      maxMultiplier: 200,
      apiKey: "test-key",
    };

    const isNoOp = 
      currentRegime.fortressSpreadBps === request.fortressSpreadBps &&
      currentRegime.maxMultiplier === request.maxMultiplier;

    expect(isNoOp).toBe(false);
  });

  it("detects change when both differ", () => {
    const request = {
      regimeId: 2,
      fortressSpreadBps: 150,
      maxMultiplier: 200,
      apiKey: "test-key",
    };

    const isNoOp = 
      currentRegime.fortressSpreadBps === request.fortressSpreadBps &&
      currentRegime.maxMultiplier === request.maxMultiplier;

    expect(isNoOp).toBe(false);
  });
});

// ========================================
// Validation Constants Tests
// ========================================

describe("Validation Constants", () => {
  it("has correct min fortress spread", () => {
    expect(VALIDATION.MIN_FORTRESS_SPREAD_BPS).toBe(1);
  });

  it("has correct max fortress spread", () => {
    expect(VALIDATION.MAX_FORTRESS_SPREAD_BPS).toBe(10000);
  });

  it("has correct min max multiplier", () => {
    expect(VALIDATION.MIN_MAX_MULTIPLIER).toBe(1);
  });

  it("has correct max max multiplier", () => {
    expect(VALIDATION.MAX_MAX_MULTIPLIER).toBe(1000);
  });
});
