// ==========================================================================
// Workflow 1: Price Integrity (15m Batch OHLC Compare)
// ==========================================================================
//
// This workflow:
// 1. Triggers every 15 minutes via cron
// 2. Fetches internal and Chainlink OHLC candles
// 3. Computes matching metrics and score
// 4. Submits report to PriceIntegrity contract
//
// Trigger: cron (*/15 * * * *)
// Contract: PriceIntegrity.submitBatchComparison(...)
//
// REAL CONTRACT: 0xe8fF31c2A959e35988DB3dF29Ce5A737D7edBd60 (Sepolia)
// To use real contract: cre workflow simulate price-integrity --target sepolia-real --broadcast

import {
  CronCapability,
  handler,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { configSchema, type Config, type Candle } from "./types";
import { priceIntegrityConfig } from "./config";
import { createApiClient } from "./lib/api";
import { submitPriceIntegrityReport, withRetry } from "./lib/ethereum";
import { hashCandles, computeDiffMerkleRoot } from "./lib/hash";
import { getEvmConfig } from "./config";

// ========================================
// Metrics Computation
// ========================================

interface ComputedMetrics {
  ohlcMaeBps: number;
  ohlcP95Bps: number;
  ohlcMaxBps: number;
  directionMatchBps: number;
  outlierCount: number;
}

/**
 * Compute per-candle error in basis points
 */
const computeCandleError = (internal: Candle, chainlink: Candle): number => {
  const intOpen = parseFloat(internal.open);
  const intHigh = parseFloat(internal.high);
  const intLow = parseFloat(internal.low);
  const intClose = parseFloat(internal.close);

  const clOpen = parseFloat(chainlink.open);
  const clHigh = parseFloat(chainlink.high);
  const clLow = parseFloat(chainlink.low);
  const clClose = parseFloat(chainlink.close);

  // Compute absolute differences in bps for each field
  const openErr = Math.abs((intOpen - clOpen) / clOpen) * 10000;
  const highErr = Math.abs((intHigh - clHigh) / clHigh) * 10000;
  const lowErr = Math.abs((intLow - clLow) / clLow) * 10000;
  const closeErr = Math.abs((intClose - clClose) / clClose) * 10000;

  // Average of OHLC errors
  return (openErr + highErr + lowErr + closeErr) / 4;
};

/**
 * Compute direction match (did both candles move same direction?)
 */
const computeDirectionMatch = (internal: Candle, chainlink: Candle): boolean => {
  const intOpen = parseFloat(internal.open);
  const intClose = parseFloat(internal.close);
  const clOpen = parseFloat(chainlink.open);
  const clClose = parseFloat(chainlink.close);

  const intDirection = intClose >= intOpen ? 1 : -1;
  const clDirection = clClose >= clOpen ? 1 : -1;

  return intDirection === clDirection;
};

/**
 * Compute all metrics for candle comparison
 */
const computeMetrics = (
  internalCandles: Candle[],
  chainlinkCandles: Candle[]
): ComputedMetrics => {
  const errors: number[] = [];
  let directionMatches = 0;
  let outlierCount = 0;

  const minLength = Math.min(internalCandles.length, chainlinkCandles.length);

  for (let i = 0; i < minLength; i++) {
    const int = internalCandles[i];
    const cl = chainlinkCandles[i];

    // Compute error
    const error = computeCandleError(int, cl);
    errors.push(error);

    // Check outlier
    if (error > priceIntegrityConfig.outlierThresholdBps) {
      outlierCount++;
    }

    // Check direction match
    if (computeDirectionMatch(int, cl)) {
      directionMatches++;
    }
  }

  if (errors.length === 0) {
    return {
      ohlcMaeBps: 0,
      ohlcP95Bps: 0,
      ohlcMaxBps: 0,
      directionMatchBps: 0,
      outlierCount: 0,
    };
  }

  // Sort for percentile calculation
  errors.sort((a, b) => a - b);

  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const max = errors[errors.length - 1];

  // P95 index
  const p95Index = Math.floor(errors.length * 0.95);
  const p95 = errors[Math.min(p95Index, errors.length - 1)];

  // Direction match percentage in bps (0-10000)
  const directionMatchBps = Math.floor((directionMatches / minLength) * 10000);

  return {
    ohlcMaeBps: Math.floor(mae),
    ohlcP95Bps: Math.floor(p95),
    ohlcMaxBps: Math.floor(max),
    directionMatchBps,
    outlierCount,
  };
};

/**
 * Compute score in basis points (0-10000)
 */
const computeScore = (metrics: ComputedMetrics, candleCount: number): number => {
  const {
    weightAccuracy,
    weightP95,
    weightMax,
    weightDirection,
    weightOutliers,
  } = priceIntegrityConfig;

  // Component scores (each 0-10000)
  const sAcc = Math.max(0, 10000 - metrics.ohlcMaeBps * 200);
  const sP95 = Math.max(0, 10000 - metrics.ohlcP95Bps * 100);
  const sMax = Math.max(0, 10000 - metrics.ohlcMaxBps * 50);
  const sDir = metrics.directionMatchBps;

  const outlierRateBps =
    candleCount > 0 ? (metrics.outlierCount * 10000) / candleCount : 0;
  const sOut = Math.max(0, 10000 - outlierRateBps * 2);

  // Weighted sum (weights sum to 10000)
  const score =
    (weightAccuracy * sAcc +
      weightP95 * sP95 +
      weightMax * sMax +
      weightDirection * sDir +
      weightOutliers * sOut) /
    10000;

  return Math.floor(score);
};

// ========================================
// Cron Trigger Handler
// ========================================

/**
 * Main handler for price integrity cron trigger
 */
const onCronTrigger = async (
  runtime: Runtime<Config>,
  payload: CronPayload
): Promise<string> => {
  // Get trigger timestamp from payload
  let triggerTimestamp = Math.floor(Date.now() / 1000);
  if (payload.scheduledExecutionTime?.seconds) {
    triggerTimestamp = Number(payload.scheduledExecutionTime.seconds);
  }

  runtime.log("========================================");
  runtime.log("Price Integrity Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  try {
    // ========================================
    // Step 1: Resolve Target Window
    // ========================================

    // Previous 15-minute window
    const windowEnd = Math.floor(triggerTimestamp / 900) * 900;
    const windowStart = windowEnd - 900;
    const epochId = Math.floor(windowStart / 900);

    runtime.log(`Processing window: ${windowStart} - ${windowEnd} (epoch ${epochId})`);

    // ========================================
    // Step 2: Check Idempotency
    // ========================================

    // TODO: Read on-chain to check if epoch already processed
    // For now, we'll rely on contract-level idempotency
    runtime.log("Checking idempotency...");

    // ========================================
    // Step 3: Fetch Candles
    // ========================================

    const apiKey = (runtime as any).secrets?.APP_API_KEY || "mock-key";
    const apiClient = createApiClient(
      runtime.config.appApiBaseUrl,
      apiKey,
      runtime.config.appApiBaseUrl.includes("localhost")
    );

    runtime.log("Fetching internal candles...");
    const internalResponse = await withRetry(() =>
      apiClient.getOhlcCandles(windowStart, windowEnd, "internal")
    );
    runtime.log(`Fetched ${internalResponse.count} internal candles`);

    runtime.log("Fetching Chainlink candles...");
    const chainlinkResponse = await withRetry(() =>
      apiClient.getOhlcCandles(windowStart, windowEnd, "chainlink")
    );
    runtime.log(`Fetched ${chainlinkResponse.count} Chainlink candles`);

    // ========================================
    // Step 4: Validate and Canonicalize
    // ========================================

    if (internalResponse.count === 0 || chainlinkResponse.count === 0) {
      throw new Error("No candles returned from API");
    }

    // Sort candles by timestamp (determinism)
    const internalCandles = [...internalResponse.candles].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const chainlinkCandles = [...chainlinkResponse.candles].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    // ========================================
    // Step 5: Compute Metrics
    // ========================================

    runtime.log("Computing metrics...");
    const metrics = computeMetrics(internalCandles, chainlinkCandles);

    runtime.log(`MAE: ${metrics.ohlcMaeBps} bps`);
    runtime.log(`P95: ${metrics.ohlcP95Bps} bps`);
    runtime.log(`Max: ${metrics.ohlcMaxBps} bps`);
    runtime.log(`Direction Match: ${metrics.directionMatchBps / 100}%`);
    runtime.log(`Outliers: ${metrics.outlierCount}`);

    // ========================================
    // Step 6: Compute Score
    // ========================================

    const scoreBps = computeScore(metrics, internalCandles.length);
    runtime.log(`Score: ${scoreBps} bps`);

    // ========================================
    // Step 7: Derive Pass/Fail Flags
    // ========================================

    const isPassed =
      scoreBps >= priceIntegrityConfig.minScoreBps &&
      metrics.ohlcP95Bps <= priceIntegrityConfig.maxOhlcP95Bps;

    let failureFlags = 0;
    if (scoreBps < priceIntegrityConfig.minScoreBps) {
      failureFlags |= 1; // Bit 0: Low score
    }
    if (metrics.ohlcP95Bps > priceIntegrityConfig.maxOhlcP95Bps) {
      failureFlags |= 2; // Bit 1: High P95
    }

    runtime.log(`Passed: ${isPassed}`);
    runtime.log(`Failure Flags: ${failureFlags}`);

    // ========================================
    // Step 8: Compute Hashes
    // ========================================

    const internalCandlesHash = hashCandles(internalCandles);
    const chainlinkCandlesHash = hashCandles(chainlinkCandles);
    const diffMerkleRoot = computeDiffMerkleRoot(
      internalCandles,
      chainlinkCandles
    );

    runtime.log(`Internal Hash: ${internalCandlesHash}`);
    runtime.log(`Chainlink Hash: ${chainlinkCandlesHash}`);
    runtime.log(`Diff Root: ${diffMerkleRoot}`);

    // ========================================
    // Step 9: Submit On-Chain
    // ========================================

    const evmConfig = getEvmConfig(runtime.config);

    const reportPayload = {
      epochId,
      windowStart,
      candleCount: internalCandles.length,
      internalCandlesHash,
      chainlinkCandlesHash,
      ohlcMaeBps: metrics.ohlcMaeBps,
      ohlcP95Bps: metrics.ohlcP95Bps,
      ohlcMaxBps: metrics.ohlcMaxBps,
      directionMatchBps: metrics.directionMatchBps,
      outlierCount: metrics.outlierCount,
      scoreBps,
      diffMerkleRoot,
    };

    const txHash = submitPriceIntegrityReport(runtime, evmConfig, reportPayload);

    runtime.log("========================================");
    runtime.log("Price Integrity Workflow Completed");
    runtime.log(`Transaction: ${txHash}`);
    runtime.log("========================================");

    return `Price integrity report submitted for epoch ${epochId}. Tx: ${txHash}`;
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
  console.log("Initializing Price Integrity Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  // Create cron trigger for 15-minute schedule
  const cronTrigger = new CronCapability().trigger({
    schedule: "*/15 * * * *",
  });

  // Register handler
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
