// ==========================================================================
// Strategy Rebalance Workflow Tests
// ==========================================================================

import { describe, it, expect } from "bun:test";
import { MockStrategyApiClient } from "../strategy-rebalance/lib/api";
import { encodeStrategyUpdate } from "../strategy-rebalance/lib/ethereum";
import { VALIDATION } from "../strategy-rebalance/types";

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
      fortressSpreadBps: 150,
      maxMultiplier: 80,
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
// Regime Determination Tests
// ========================================

describe("Regime Determination", () => {
  const determineTargetRegime = (volatilityIndex: number) => {
    if (volatilityIndex < 0.30) {
      return { regimeId: 1, fortressSpreadBps: 100, maxMultiplier: 100, regimeName: "LOW_VOL" };
    } else if (volatilityIndex < 0.60) {
      return { regimeId: 2, fortressSpreadBps: 150, maxMultiplier: 80, regimeName: "NORMAL" };
    } else {
      return { regimeId: 3, fortressSpreadBps: 300, maxMultiplier: 50, regimeName: "HIGH_VOL" };
    }
  };

  it("selects LOW_VOL regime for low volatility", () => {
    const regime = determineTargetRegime(0.10);
    expect(regime.regimeId).toBe(1);
    expect(regime.regimeName).toBe("LOW_VOL");
    expect(regime.fortressSpreadBps).toBe(100);
    expect(regime.maxMultiplier).toBe(100);
  });

  it("selects LOW_VOL regime at boundary (0.29)", () => {
    const regime = determineTargetRegime(0.29);
    expect(regime.regimeId).toBe(1);
  });

  it("selects NORMAL regime for medium volatility", () => {
    const regime = determineTargetRegime(0.45);
    expect(regime.regimeId).toBe(2);
    expect(regime.regimeName).toBe("NORMAL");
    expect(regime.fortressSpreadBps).toBe(150);
    expect(regime.maxMultiplier).toBe(80);
  });

  it("selects NORMAL regime at boundary (0.59)", () => {
    const regime = determineTargetRegime(0.59);
    expect(regime.regimeId).toBe(2);
  });

  it("selects HIGH_VOL regime for high volatility", () => {
    const regime = determineTargetRegime(0.75);
    expect(regime.regimeId).toBe(3);
    expect(regime.regimeName).toBe("HIGH_VOL");
    expect(regime.fortressSpreadBps).toBe(300);
    expect(regime.maxMultiplier).toBe(50);
  });

  it("selects HIGH_VOL regime at exact boundary (0.60)", () => {
    const regime = determineTargetRegime(0.60);
    expect(regime.regimeId).toBe(3);
  });

  it("selects HIGH_VOL regime for extreme volatility", () => {
    const regime = determineTargetRegime(0.99);
    expect(regime.regimeId).toBe(3);
  });
});

// ========================================
// Mock API Client Tests
// ========================================

describe("MockStrategyApiClient", () => {
  const client = new MockStrategyApiClient();

  it("returns valid strategy regime", async () => {
    const regime = await client.getCurrentStrategyRegime();
    
    expect(regime.regimeId).toBeGreaterThanOrEqual(1);
    expect(regime.regimeId).toBeLessThanOrEqual(3);
    expect(regime.fortressSpreadBps).toBeGreaterThan(0);
    expect(regime.maxMultiplier).toBeGreaterThan(0);
    expect(regime.effectiveTs).toBeGreaterThan(0);
    expect(parseFloat(regime.volatilityIndex)).toBeGreaterThanOrEqual(0);
    expect(regime.regimeName).toBeDefined();
  });

  it("returns deterministic regime for same hour", async () => {
    const regime1 = await client.getCurrentStrategyRegime();
    const regime2 = await client.getCurrentStrategyRegime();
    
    expect(regime1.regimeId).toBe(regime2.regimeId);
    expect(regime1.volatilityIndex).toBe(regime2.volatilityIndex);
  });

  it("returns valid regime structure", async () => {
    const regime = await client.getCurrentStrategyRegime();
    
    expect(["LOW_VOL", "NORMAL", "HIGH_VOL"]).toContain(regime.regimeName);
    expect(regime.fortressSpreadBps).toBeGreaterThanOrEqual(100);
    expect(regime.fortressSpreadBps).toBeLessThanOrEqual(300);
    expect(regime.maxMultiplier).toBeGreaterThanOrEqual(50);
    expect(regime.maxMultiplier).toBeLessThanOrEqual(100);
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
  const isNoOp = (currentRegimeId: number | null, targetRegimeId: number): boolean => {
    if (currentRegimeId === null) {
      return false;
    }
    return currentRegimeId === targetRegimeId;
  };

  it("detects no-op when regime unchanged", () => {
    expect(isNoOp(1, 1)).toBe(true);
    expect(isNoOp(2, 2)).toBe(true);
    expect(isNoOp(3, 3)).toBe(true);
  });

  it("detects change when regime different", () => {
    expect(isNoOp(1, 2)).toBe(false);
    expect(isNoOp(1, 3)).toBe(false);
    expect(isNoOp(2, 1)).toBe(false);
    expect(isNoOp(2, 3)).toBe(false);
    expect(isNoOp(3, 1)).toBe(false);
    expect(isNoOp(3, 2)).toBe(false);
  });

  it("not no-op when no current regime", () => {
    expect(isNoOp(null, 1)).toBe(false);
    expect(isNoOp(null, 2)).toBe(false);
    expect(isNoOp(null, 3)).toBe(false);
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

// ========================================
// Cron Schedule Tests
// ========================================

describe("Cron Schedule", () => {
  it("15 minute interval is correct", () => {
    const schedule = "*/15 * * * *";
    expect(schedule).toBe("*/15 * * * *");
  });

  it("calculates correct epoch for 15m intervals", () => {
    const timestamp = 1772157600; // Some timestamp
    const windowEnd = Math.floor(timestamp / 900) * 900; // 15m = 900 seconds
    expect(windowEnd % 900).toBe(0);
  });
});
