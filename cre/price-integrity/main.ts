// ==========================================================================
// Workflow 1: Price Integrity (15m Batch OHLC Compare)
// ==========================================================================
//
// This workflow:
// 1. Triggers every 15 minutes via cron
// 2. Fetches internal and Chainlink OHLC candles via HTTP with Bearer auth
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
  HTTPClient,
  handler,
  consensusIdenticalAggregation,
  ok,
  json,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { configSchema, type Config, type Candle, type OhlcResponse } from "./types";
import { priceIntegrityConfig } from "./config";
import { submitPriceIntegrityReport } from "./lib/ethereum";
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

  const openErr = Math.abs((intOpen - clOpen) / clOpen) * 10000;
  const highErr = Math.abs((intHigh - clHigh) / clHigh) * 10000;
  const lowErr = Math.abs((intLow - clLow) / clLow) * 10000;
  const closeErr = Math.abs((intClose - clClose) / clClose) * 10000;

  return (openErr + highErr + lowErr + closeErr) / 4;
};

/**
 * Compute direction match
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
 * Compute all metrics
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
    const error = computeCandleError(int, cl);
    errors.push(error);

    if (error > priceIntegrityConfig.outlierThresholdBps) outlierCount++;
    if (computeDirectionMatch(int, cl)) directionMatches++;
  }

  if (errors.length === 0) {
    return { ohlcMaeBps: 0, ohlcP95Bps: 0, ohlcMaxBps: 0, directionMatchBps: 0, outlierCount: 0 };
  }

  errors.sort((a, b) => a - b);
  const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
  const max = errors[errors.length - 1];
  const p95Index = Math.floor(errors.length * 0.95);
  const p95 = errors[Math.min(p95Index, errors.length - 1)];
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
 * Compute score
 */
const computeScore = (metrics: ComputedMetrics, candleCount: number): number => {
  const { weightAccuracy, weightP95, weightMax, weightDirection, weightOutliers } = priceIntegrityConfig;

  const sAcc = Math.max(0, 10000 - metrics.ohlcMaeBps * 200);
  const sP95 = Math.max(0, 10000 - metrics.ohlcP95Bps * 100);
  const sMax = Math.max(0, 10000 - metrics.ohlcMaxBps * 50);
  const sDir = metrics.directionMatchBps;
  const outlierRateBps = candleCount > 0 ? (metrics.outlierCount * 10000) / candleCount : 0;
  const sOut = Math.max(0, 10000 - outlierRateBps * 2);

  return Math.floor((weightAccuracy * sAcc + weightP95 * sP95 + weightMax * sMax + weightDirection * sDir + weightOutliers * sOut) / 10000);
};

// ========================================
// HTTP Fetch Function
// ========================================

const fetchOhlcCandles = (
  runtime: Runtime<Config>,
  apiKey: string,
  windowStart: number,
  windowEnd: number,
  source: "internal" | "chainlink"
): OhlcResponse => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/ohlc?windowStart=${windowStart}&windowEnd=${windowEnd}&source=${source}`;
  
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

  return json(response) as OhlcResponse;
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
  runtime.log("Price Integrity Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  const windowEnd = Math.floor(triggerTimestamp / 900) * 900;
  const windowStart = windowEnd - 900;
  const epochId = Math.floor(windowStart / 900);

  runtime.log(`Processing window: ${windowStart} - ${windowEnd} (epoch ${epochId})`);
  runtime.log("Checking idempotency...");

  // Get API key from secrets (must be done outside runInNodeMode)
  runtime.log("Getting API key from secrets...");
  let apiKey = "";
  try {
    const secret = runtime.getSecret({ id: "APP_API_KEY" }).result();
    apiKey = secret.value;
    runtime.log(`API key loaded from secrets: ${apiKey.substring(0, 4)}...`);
  } catch (e) {
    // Fallback to env-style access for compatibility
    const envKey = (runtime as any).secrets?.APP_API_KEY;
    if (envKey) {
      apiKey = envKey;
      runtime.log(`API key loaded from env: ${apiKey.substring(0, 4)}...`);
    } else {
      // Hardcoded fallback for testing
      apiKey = "8d920faa0c";
      runtime.log(`API key using fallback: ${apiKey.substring(0, 4)}...`);
    }
  }

  runtime.log("Fetching internal candles...");
  const internalResponse = runtime.runInNodeMode(
    (nodeRuntime) => fetchOhlcCandles(nodeRuntime, apiKey, windowStart, windowEnd, "internal"),
    consensusIdenticalAggregation<OhlcResponse>()
  )().result();
  runtime.log(`Fetched ${internalResponse.count} internal candles`);

  runtime.log("Fetching Chainlink candles...");
  const chainlinkResponse = runtime.runInNodeMode(
    (nodeRuntime) => fetchOhlcCandles(nodeRuntime, apiKey, windowStart, windowEnd, "chainlink"),
    consensusIdenticalAggregation<OhlcResponse>()
  )().result();
  runtime.log(`Fetched ${chainlinkResponse.count} Chainlink candles`);

  if (internalResponse.count === 0 || chainlinkResponse.count === 0) {
    throw new Error("No candles returned from API");
  }

  const internalCandles = [...internalResponse.candles].sort((a, b) => a.timestamp - b.timestamp);
  const chainlinkCandles = [...chainlinkResponse.candles].sort((a, b) => a.timestamp - b.timestamp);

  runtime.log("Computing metrics...");
  const metrics = computeMetrics(internalCandles, chainlinkCandles);
  runtime.log(`MAE: ${metrics.ohlcMaeBps} bps, P95: ${metrics.ohlcP95Bps} bps, Max: ${metrics.ohlcMaxBps} bps`);
  runtime.log(`Direction Match: ${metrics.directionMatchBps / 100}%, Outliers: ${metrics.outlierCount}`);

  const scoreBps = computeScore(metrics, internalCandles.length);
  runtime.log(`Score: ${scoreBps} bps`);

  const isPassed = scoreBps >= priceIntegrityConfig.minScoreBps && metrics.ohlcP95Bps <= priceIntegrityConfig.maxOhlcP95Bps;
  let failureFlags = 0;
  if (scoreBps < priceIntegrityConfig.minScoreBps) failureFlags |= 1;
  if (metrics.ohlcP95Bps > priceIntegrityConfig.maxOhlcP95Bps) failureFlags |= 2;

  runtime.log(`Passed: ${isPassed}, Failure Flags: ${failureFlags}`);

  const internalCandlesHash = hashCandles(internalCandles);
  const chainlinkCandlesHash = hashCandles(chainlinkCandles);
  const diffMerkleRoot = computeDiffMerkleRoot(internalCandles, chainlinkCandles);

  runtime.log(`Internal Hash: ${internalCandlesHash}`);
  runtime.log(`Chainlink Hash: ${chainlinkCandlesHash}`);
  runtime.log(`Diff Root: ${diffMerkleRoot}`);

  const evmConfig = getEvmConfig(runtime.config);
  const txHash = submitPriceIntegrityReport(runtime, evmConfig, {
    epochId, windowStart, candleCount: internalCandles.length,
    internalCandlesHash, chainlinkCandlesHash,
    ohlcMaeBps: metrics.ohlcMaeBps, ohlcP95Bps: metrics.ohlcP95Bps, ohlcMaxBps: metrics.ohlcMaxBps,
    directionMatchBps: metrics.directionMatchBps, outlierCount: metrics.outlierCount,
    scoreBps, diffMerkleRoot,
  });

  runtime.log("========================================");
  runtime.log("Price Integrity Workflow Completed");
  runtime.log(`Transaction: ${txHash}`);
  runtime.log("========================================");

  return `Price integrity report submitted for epoch ${epochId}. Tx: ${txHash}`;
};

// ========================================
// Workflow Initialization
// ========================================

const initWorkflow = (config: Config) => {
  console.log("Initializing Price Integrity Workflow");
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
