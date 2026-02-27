// ==========================================================================
// Configuration Management for Tap.fun CRE Workflows
// ==========================================================================

import { Config, EvmConfig } from "./types";

// ========================================
// Default Configurations
// ========================================

export const defaultConfig: Config = {
  appApiBaseUrl: "http://localhost:3000/api/v1",
  evms: [
    {
      chainSelectorName: "ethereum-testnet-sepolia",
      chainId: 11155111,
      priceIntegrityAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      settlementAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      poolReserveAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      lpDistributorAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      strategyManagerAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      gasLimit: "1000000",
    },
  ],
};

// ========================================
// EVM Configuration Helpers
// ========================================

export const getEvmConfig = (config: Config, chainSelectorName?: string): EvmConfig => {
  if (chainSelectorName) {
    const evm = config.evms.find(e => e.chainSelectorName === chainSelectorName);
    if (!evm) {
      throw new Error(`EVM config not found for chain: ${chainSelectorName}`);
    }
    return evm;
  }
  return config.evms[0];
};

// ========================================
// Workflow-Specific Configs
// ========================================

export const priceIntegrityConfig = {
  // Score thresholds
  minScoreBps: 9000,        // 90% minimum score to pass
  maxOhlcP95Bps: 50,        // 0.5% maximum P95 deviation
  
  // Scoring weights (must sum to 10000)
  weightAccuracy: 5000,     // 50% - MAE component
  weightP95: 2000,          // 20% - P95 component
  weightMax: 1000,          // 10% - Max error component
  weightDirection: 1000,    // 10% - Direction match component
  weightOutliers: 1000,     // 10% - Outlier rate component
  
  // Outlier threshold
  outlierThresholdBps: 50,  // Candle error > 50 bps = outlier
  
  // Cron cadence (for documentation)
  cronCadence: "*/15 * * * *", // Every 15 minutes
};

export const settlementConfig = {
  // Merkle tree configuration
  merkleLeafEncoding: ["address", "uint256"] as const,
  
  // Cron cadence
  cronCadence: "*/15 * * * *", // Every 15 minutes
};

export const poolSolvencyConfig = {
  // Solvency threshold
  minSolvencyRatio: 1.5,    // 1.5x minimum
  
  // Cron cadence
  cronCadence: "0 0 * * *", // Daily at midnight
};

export const lpDistributionConfig = {
  // Cron cadence
  cronCadence: "0 0 * * *", // Daily at midnight
};

export const strategyRebalanceConfig = {
  // Value ranges
  minSpreadBps: 1,          // 0.01% minimum spread
  maxSpreadBps: 1000,       // 10% maximum spread
  minMultiplier: 1,         // 1x minimum
  maxMultiplier: 1000,      // 1000x maximum
};
