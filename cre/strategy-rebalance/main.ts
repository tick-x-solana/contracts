// ==========================================================================
// Workflow 5: Strategy Rebalance (15m Cron Trigger)
// ==========================================================================
//
// This workflow:
// 1. Triggers every 15 minutes via cron
// 2. Fetches current on-chain regime from StrategyManager
// 3. Fetches current volatility data from API
// 4. Determines target regime based on volatility index
// 5. Detects regime changes (current vs target)
// 6. No-op if target equals current
// 7. Updates strategy on-chain via StrategyManager.setVolatilityRegime()
// 8. Logs update via API
//
// Trigger: cron (*/15 * * * *)
// Contract: StrategyManager.setVolatilityRegime(...)

import {
  CronCapability,
  handler,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type EvmConfig, type VolatilityRegime, getEvmConfig } from "./types";
import { createApiClient } from "./lib/api";
import { setVolatilityRegime, readCurrentRegime, regimeExists, withRetry } from "./lib/ethereum";

// ========================================
// Regime Configuration
// ========================================

interface RegimeConfig {
  regimeId: number;
  fortressSpreadBps: number;
  maxMultiplier: number;
  regimeName: string;
}

// Regime thresholds and parameters
const REGIMES: Record<number, RegimeConfig> = {
  1: { regimeId: 1, fortressSpreadBps: 100, maxMultiplier: 100, regimeName: "LOW_VOL" },
  2: { regimeId: 2, fortressSpreadBps: 150, maxMultiplier: 80, regimeName: "NORMAL" },
  3: { regimeId: 3, fortressSpreadBps: 300, maxMultiplier: 50, regimeName: "HIGH_VOL" },
};

/**
 * Determine target regime based on volatility index
 */
const determineTargetRegime = (volatilityIndex: number): RegimeConfig => {
  if (volatilityIndex < 0.30) {
    return REGIMES[1]; // LOW_VOL
  } else if (volatilityIndex < 0.60) {
    return REGIMES[2]; // NORMAL
  } else {
    return REGIMES[3]; // HIGH_VOL
  }
};

// ========================================
// No-Op Detection
// ========================================

const isNoOp = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  targetRegime: RegimeConfig
): Promise<boolean> => {
  const currentRegime = await withRetry(() => readCurrentRegime(runtime, evmConfig));
  
  if (!currentRegime) {
    return false; // No current regime, not a no-op
  }
  
  // Check if regime ID is the same
  return currentRegime.regimeId === targetRegime.regimeId;
};

// ========================================
// Cron Trigger Handler
// ========================================

const onCronTrigger = async (
  runtime: Runtime<Config>,
  payload: CronPayload
): Promise<string> => {
  // Extract timestamp
  let triggerTimestamp = Math.floor(Date.now() / 1000);
  if (payload.scheduledExecutionTime?.seconds) {
    triggerTimestamp = Number(payload.scheduledExecutionTime.seconds);
  }

  runtime.log("========================================");
  runtime.log("Strategy Rebalance Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  try {
    // ========================================
    // Step 1: Read Current On-Chain Regime
    // ========================================

    const evmConfig = getEvmConfig(runtime.config);
    
    runtime.log("Reading current regime from chain...");
    const currentRegime = await withRetry(() => readCurrentRegime(runtime, evmConfig));
    
    if (currentRegime) {
      runtime.log(`Current regime: ${currentRegime.regimeId} (spread: ${currentRegime.fortressSpreadBps} bps, multiplier: ${currentRegime.maxMultiplier}x)`);
    } else {
      runtime.log("No current regime set on-chain");
    }

    // ========================================
    // Step 2: Fetch Volatility Data from API
    // ========================================

    const apiKey = (runtime as any).secrets?.APP_API_KEY || "mock-key";
    const apiClient = createApiClient(
      runtime.config.appApiBaseUrl,
      apiKey,
      runtime.config.appApiBaseUrl.includes("localhost")
    );

    runtime.log("Fetching current strategy regime...");
    const strategyRegime = await withRetry(() => apiClient.getCurrentStrategyRegime());
    
    const volatilityIndex = parseFloat(strategyRegime.volatilityIndex);
    runtime.log(`Volatility index: ${volatilityIndex}`);
    runtime.log(`Current regime name: ${strategyRegime.regimeName}`);

    // ========================================
    // Step 3: Determine Target Regime
    // ========================================

    runtime.log("Determining target regime...");
    const targetRegime = determineTargetRegime(volatilityIndex);
    
    runtime.log(`Target regime: ${targetRegime.regimeName} (${targetRegime.regimeId})`);
    runtime.log(`  Fortress spread: ${targetRegime.fortressSpreadBps} bps`);
    runtime.log(`  Max multiplier: ${targetRegime.maxMultiplier}x`);

    // ========================================
    // Step 4: No-Op Detection
    // ========================================

    runtime.log("Checking for no-op update...");
    const noOp = await isNoOp(runtime, evmConfig, targetRegime);
    
    if (noOp) {
      runtime.log("No-op detected: target regime matches current on-chain regime. Skipping.");
      return `No-op: regime ${targetRegime.regimeName} already active`;
    }

    // ========================================
    // Step 5: Check Idempotency
    // ========================================

    runtime.log("Checking idempotency...");
    const exists = await withRetry(() => regimeExists(runtime, evmConfig, targetRegime.regimeId));
    if (exists) {
      runtime.log(`Regime ${targetRegime.regimeId} already exists on-chain. Skipping.`);
      return `Skipped: regime ${targetRegime.regimeId} already exists`;
    }

    // ========================================
    // Step 6: Update Strategy On-Chain
    // ========================================

    runtime.log("Updating volatility regime on-chain...");
    const txHash = setVolatilityRegime(runtime, evmConfig, {
      regimeId: targetRegime.regimeId,
      fortressSpreadBps: targetRegime.fortressSpreadBps,
      maxMultiplier: targetRegime.maxMultiplier,
    });

    // ========================================
    // Step 7: Log Update via API
    // ========================================

    runtime.log("Logging strategy update...");
    try {
      await apiClient.logStrategyUpdate(
        targetRegime.regimeId,
        targetRegime.fortressSpreadBps,
        targetRegime.maxMultiplier,
        txHash
      );
      runtime.log("Strategy update logged");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtime.log(`Warning: Failed to log strategy update: ${message}`);
      // Non-critical error, continue
    }

    // ========================================
    // Step 8: Return Result
    // ========================================

    runtime.log("========================================");
    runtime.log("Strategy Rebalance Workflow Completed");
    runtime.log(`Regime ${targetRegime.regimeName} (${targetRegime.regimeId}) activated`);
    runtime.log(`Transaction: ${txHash}`);
    runtime.log("========================================");

    return `Strategy updated to ${targetRegime.regimeName} (regime ${targetRegime.regimeId}). Tx: ${txHash}`;

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.log(`ERROR: ${message}`);
    throw error;
  }
};

// ========================================
// Workflow Initialization
// ========================================

const initWorkflow = (config: Config) => {
  console.log("Initializing Strategy Rebalance Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  // Cron trigger - every 15 minutes (aligned with other workflows)
  const cronTrigger = new CronCapability().trigger({
    schedule: "*/15 * * * *",
  });

  return [handler(cronTrigger, onCronTrigger)];
};

// ========================================
// Entry Point
// ========================================

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
