// ==========================================================================
// Pool Solvency Workflow Tests
// ==========================================================================

import { describe, it, expect } from "bun:test";
import { MockSolvencyApiClient } from "../pool-solvency/lib/api";
import { MIN_SOLVENCY_RATIO, RATIO_PRECISION } from "../pool-solvency/types";

// ========================================
// Solvency Ratio Calculation Tests
// ========================================

describe("Solvency Ratio Calculation", () => {
  const calculateSolvencyRatio = (poolBalance: bigint, totalLiability: bigint): bigint => {
    if (totalLiability === 0n) {
      return BigInt(Number.MAX_SAFE_INTEGER);
    }
    return (poolBalance * RATIO_PRECISION) / totalLiability;
  };

  const formatRatio = (ratio: bigint): string => {
    const integerPart = ratio / RATIO_PRECISION;
    const fractionalPart = (ratio % RATIO_PRECISION) * 100n / RATIO_PRECISION;
    return `${integerPart}.${fractionalPart.toString().padStart(2, "0")}x`;
  };

  it("calculates correct ratio for healthy pool", () => {
    // 100,000 balance / 50,000 liability = 2.0x
    const poolBalance = BigInt(100000) * BigInt(1e18);
    const totalLiability = BigInt(50000) * BigInt(1e18);
    const ratio = calculateSolvencyRatio(poolBalance, totalLiability);
    
    expect(ratio).toBe(2000000000000000000n); // 2.0e18
    expect(formatRatio(ratio)).toBe("2.00x");
  });

  it("calculates correct ratio for exactly 1.5x minimum", () => {
    // 75,000 balance / 50,000 liability = 1.5x
    const poolBalance = BigInt(75000) * BigInt(1e18);
    const totalLiability = BigInt(50000) * BigInt(1e18);
    const ratio = calculateSolvencyRatio(poolBalance, totalLiability);
    
    expect(ratio).toBe(MIN_SOLVENCY_RATIO); // 1.5e18
    expect(formatRatio(ratio)).toBe("1.50x");
  });

  it("identifies under-collateralized pool", () => {
    // 60,000 balance / 50,000 liability = 1.2x (below 1.5x minimum)
    const poolBalance = BigInt(60000) * BigInt(1e18);
    const totalLiability = BigInt(50000) * BigInt(1e18);
    const ratio = calculateSolvencyRatio(poolBalance, totalLiability);
    
    expect(ratio).toBe(1200000000000000000n); // 1.2e18
    expect(ratio < MIN_SOLVENCY_RATIO).toBe(true);
    expect(formatRatio(ratio)).toBe("1.20x");
  });

  it("returns max safe integer for zero liability", () => {
    const poolBalance = BigInt(100000) * BigInt(1e18);
    const totalLiability = 0n;
    const ratio = calculateSolvencyRatio(poolBalance, totalLiability);
    
    expect(ratio).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("handles very high ratios", () => {
    // 1,000,000 balance / 100 liability = 10,000x
    const poolBalance = BigInt(1000000) * BigInt(1e18);
    const totalLiability = BigInt(100) * BigInt(1e18);
    const ratio = calculateSolvencyRatio(poolBalance, totalLiability);
    
    expect(ratio).toBe(10000000000000000000000n); // 10000.0e18
    expect(formatRatio(ratio)).toBe("10000.00x");
  });
});

// ========================================
// Mock API Client Tests
// ========================================

describe("MockSolvencyApiClient", () => {
  it("returns liability data", async () => {
    const client = new MockSolvencyApiClient();
    const data = await client.getLiabilityData();
    
    expect(data.timestamp).toBeGreaterThan(0);
    expect(BigInt(data.totalLiability)).toBeGreaterThan(0n);
    expect(data.utilizationBps).toBeGreaterThanOrEqual(0);
    expect(BigInt(data.maxSingleBetExposure)).toBeGreaterThan(0n);
    expect(data.outstandingBets).toBeGreaterThan(0);
  });

  it("returns deterministic data for same day", async () => {
    const client = new MockSolvencyApiClient();
    const data1 = await client.getLiabilityData();
    const data2 = await client.getLiabilityData();
    
    expect(data1.totalLiability).toBe(data2.totalLiability);
    expect(data1.utilizationBps).toBe(data2.utilizationBps);
  });

  it("sendAlert does not throw", async () => {
    const client = new MockSolvencyApiClient();
    await expect(
      client.sendAlert("Test alert", "high")
    ).resolves.toBeUndefined();
  });

  it("isHealthy=true returns lower liability", async () => {
    const healthyClient = new MockSolvencyApiClient();
    healthyClient.isHealthy = true;
    
    const unhealthyClient = new MockSolvencyApiClient();
    unhealthyClient.isHealthy = false;
    
    const healthyData = await healthyClient.getLiabilityData();
    const unhealthyData = await unhealthyClient.getLiabilityData();
    
    // Healthy scenario should have lower liability on average
    // (baseLiability: 50000 vs 90000)
    expect(BigInt(healthyData.totalLiability) < BigInt(unhealthyData.totalLiability)).toBe(true);
  });

  it("isHealthy=false returns higher utilization", async () => {
    const healthyClient = new MockSolvencyApiClient();
    healthyClient.isHealthy = true;
    
    const unhealthyClient = new MockSolvencyApiClient();
    unhealthyClient.isHealthy = false;
    
    const healthyData = await healthyClient.getLiabilityData();
    const unhealthyData = await unhealthyClient.getLiabilityData();
    
    // Unhealthy scenario should have higher utilization
    // (base: 1500-2500 bps vs 500-1500 bps)
    expect(unhealthyData.utilizationBps > healthyData.utilizationBps).toBe(true);
  });
});

// ========================================
// Epoch Calculation Tests
// ========================================

describe("Epoch Calculation", () => {
  it("calculates correct epoch ID for timestamp", () => {
    // Day 20511 corresponds to approximately 2026-02-27
    const timestamp = 1772157600; // 2026-02-27 02:00:00 UTC
    const epochId = Math.floor(timestamp / 86400);
    
    expect(epochId).toBe(20511);
  });

  it("increments epoch daily", () => {
    const day1Timestamp = 1772157600; // 2026-02-27 02:00:00 UTC
    const day2Timestamp = day1Timestamp + 86400; // +1 day
    
    const epoch1 = Math.floor(day1Timestamp / 86400);
    const epoch2 = Math.floor(day2Timestamp / 86400);
    
    expect(epoch2).toBe(epoch1 + 1);
  });
});

// ========================================
// Health Status Tests
// ========================================

describe("Health Status Determination", () => {
  it("considers ratio >= 1.5x as healthy", () => {
    const ratios = [
      1500000000000000000n, // exactly 1.5x
      2000000000000000000n, // 2.0x
      5000000000000000000n, // 5.0x
      100000000000000000000n, // 100x
    ];
    
    for (const ratio of ratios) {
      const isHealthy = ratio >= MIN_SOLVENCY_RATIO;
      expect(isHealthy).toBe(true);
    }
  });

  it("considers ratio < 1.5x as unhealthy", () => {
    const ratios = [
      0n,
      1000000000000000000n, // 1.0x
      1499999999999999999n, // just below 1.5x
    ];
    
    for (const ratio of ratios) {
      const isHealthy = ratio >= MIN_SOLVENCY_RATIO;
      expect(isHealthy).toBe(false);
    }
  });
});
