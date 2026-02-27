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
//
// REAL CONTRACT: 0x51c6B0cA0F3620248438B1FCCcaEfd67fca5a660 (Sepolia)
// To use real contract: cre workflow simulate strategy-rebalance --target sepolia-real --broadcast

import {
  CronCapability,
  HTTPClient,
  handler,
  consensusIdenticalAggregation,
  ok,
  json,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type EvmConfig, type VolatilityRegime, getEvmConfig } from "./types";
import { setVolatilityRegime, readCurrentRegime, regimeExists } from "./lib/ethereum";

// ========================================
// HTTP Fetch Functions
// ========================================

const fetchStrategyRegime = (
  runtime: Runtime<Config>,
  apiKey: string
): VolatilityRegime => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/strategy/current`;

  const response = client
    .sendRequest(runtime, {
      url,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    })
    .result();

  if (!ok(response)) {
    throw new Error(`HTTP request failed with status: ${response.statusCode}`);
  }

  return json(response) as VolatilityRegime;
};

const logStrategyUpdate = (
  runtime: Runtime<Config>,
  apiKey: string,
  regimeId: number,
  txHash: string
): void => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/strategy/log`;
  const bodyData = JSON.stringify({
    regimeId,
    txHash,
    timestamp: Math.floor(Date.now() / 1000),
  });

  const response = client
    .sendRequest(runtime, {
      url,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: new TextEncoder().encode(bodyData),
    })
    .result();

  if (!ok(response)) {
    runtime.log(`Warning: Failed to log strategy update: ${response.statusCode}`);
  }
};

// ========================================
// Regime Configuration
// ========================================

interface RegimeConfig {
  regimeId: number;
  fortressSpreadBps: number;
  maxMultiplier: number;
  regimeName: string;
}

const REGIMES: Record<number, RegimeConfig> = {
  1: { regimeId: 1, fortressSpreadBps: 100, maxMultiplier: 100, regimeName: "LOW_VOL" },
  2: { regimeId: 2, fortressSpreadBps: 150, maxMultiplier: 80, regimeName: "NORMAL" },
  3: { regimeId: 3, fortressSpreadBps: 300, maxMultiplier: 50, regimeName: "HIGH_VOL" },
};

const determineTargetRegime = (volatilityIndex: number): RegimeConfig => {
  if (volatilityIndex < 0.30) {
    return REGIMES[1];
  } else if (volatilityIndex < 0.60) {
    return REGIMES[2];
  } else {
    return REGIMES[3];
  }
};

// ========================================
// Cron Trigger Handler
// ========================================

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  let triggerTimestamp = Math.floor(Date.now() / 1000);
  if (payload.scheduledExecutionTime?.seconds) {
    triggerTimestamp = Number(payload.scheduledExecutionTime.seconds);
  }

  runtime.log("========================================");
  runtime.log("Strategy Rebalance Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  // Get API key (3-tier fallback)
  let apiKey = "";
  try {
    const secret = runtime.getSecret({ id: "APP_API_KEY" }).result();
    apiKey = secret.value;
  } catch (e) {
    const envKey = (runtime as any).secrets?.APP_API_KEY;
    if (envKey) {
      apiKey = envKey;
    } else {
      apiKey = "8d920faa0c";
    }
  }

  const evmConfig = getEvmConfig(runtime.config);

  // Read current regime from chain
  runtime.log("Reading current regime from chain...");
  const currentRegime = readCurrentRegime(runtime, evmConfig);
  if (currentRegime.exists) {
    runtime.log(`Current regime: ${currentRegime.regimeId} (spread: ${currentRegime.fortressSpreadBps} bps)`);
  } else {
    runtime.log("No current regime set on-chain");
  }

  // Fetch target regime from API
  runtime.log("Fetching current strategy regime...");
  const targetRegime = runtime.runInNodeMode(
    (nodeRuntime) => fetchStrategyRegime(nodeRuntime, apiKey),
    consensusIdenticalAggregation<VolatilityRegime>()
  )().result();
  runtime.log(`Volatility index: ${targetRegime.volatilityIndex}`);
  runtime.log(`Current regime name: ${targetRegime.regimeName}`);

  // Determine target regime
  runtime.log("Determining target regime...");
  const volatilityIndex = parseFloat(targetRegime.volatilityIndex);
  const targetConfig = determineTargetRegime(volatilityIndex);
  runtime.log(`Target regime: ${targetRegime.regimeName} (${targetRegime.regimeId})`);
  runtime.log(`Fortress spread: ${targetRegime.fortressSpreadBps} bps`);
  runtime.log(`Max multiplier: ${targetRegime.maxMultiplier}x`);

  // Check for no-op
  runtime.log("Checking for no-op update...");
  if (currentRegime.exists && currentRegime.regimeId === targetRegime.regimeId) {
    runtime.log("Regime unchanged - no update needed");
    return `No-op: Current regime ${targetRegime.regimeName} already active`;
  }

  // Check idempotency
  runtime.log("Checking idempotency...");
  if (regimeExists(runtime, evmConfig, targetRegime.regimeId)) {
    runtime.log(`Regime ${targetRegime.regimeId} already exists - checking if current`);
  }

  // Update on-chain
  runtime.log("Updating volatility regime on-chain...");
  const txHash = setVolatilityRegime(runtime, evmConfig, {
    regimeId: targetRegime.regimeId,
    fortressSpreadBps: targetRegime.fortressSpreadBps,
    maxMultiplier: targetRegime.maxMultiplier,
  });

  runtime.log(`Volatility regime set. Tx: ${txHash}`);

  // Log update via API
  // runtime.log("Logging strategy update...");
  // runtime.runInNodeMode(
  //   (nodeRuntime) => {
  //     logStrategyUpdate(nodeRuntime, apiKey, targetRegime.regimeId, txHash);
  //     return "ok";
  //   },
  //   consensusIdenticalAggregation<string>()
  // )().result();

  runtime.log("========================================");
  runtime.log("Strategy Rebalance Workflow Completed");
  runtime.log(`Regime ${targetRegime.regimeName} (${targetRegime.regimeId}) activated`);
  runtime.log(`Transaction: ${txHash}`);
  runtime.log("========================================");

  return `Strategy updated to ${targetRegime.regimeName} (regime ${targetRegime.regimeId}). Tx: ${txHash}`;
};

// ========================================
// Workflow Initialization
// ========================================

const initWorkflow = (config: Config) => {
  console.log("Initializing Strategy Rebalance Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  return [handler(new CronCapability().trigger({ schedule: "*/15 * * * *" }), onCronTrigger)];
};

// ========================================
// Entry Point
// ========================================

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
