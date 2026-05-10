import { createHash } from "node:crypto";

import { fetchOhlcCandles } from "./api.js";
import { workerConfig } from "./config.js";
import { computeMetrics } from "./compute.js";
import type { Candle, ComputedMetrics, MetricName, PriceIntegritySnapshot } from "./types.js";

function hashCandles(candles: Candle[]): `0x${string}` {
  const payload = JSON.stringify(candles);
  return `0x${createHash("sha256").update(payload).digest("hex")}`;
}

function hashDiffPairs(internalCandles: Candle[], chainlinkCandles: Candle[]): `0x${string}` {
  const length = Math.min(internalCandles.length, chainlinkCandles.length);
  const normalized = [];

  for (let index = 0; index < length; index += 1) {
    normalized.push({
      timestamp: internalCandles[index].timestamp,
      internal: internalCandles[index],
      chainlink: chainlinkCandles[index],
    });
  }

  return `0x${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
}

export async function computePriceIntegritySnapshot(): Promise<PriceIntegritySnapshot> {
  if (!workerConfig.appApiKey) {
    throw new Error("APP_API_KEY is required");
  }

  const now = Math.floor(Date.now() / 1000);
  const windowEnd = Math.floor(now / 900) * 900;
  const windowStart = windowEnd - 900;
  const epochId = Math.floor(windowStart / 900);
  const [internalResponse, chainlinkResponse] = await Promise.all([
    fetchOhlcCandles(workerConfig.appApiBaseUrl, workerConfig.appApiKey, windowStart, windowEnd, "internal"),
    fetchOhlcCandles(workerConfig.appApiBaseUrl, workerConfig.appApiKey, windowStart, windowEnd, "chainlink")
  ]);

  const internalCandles = [...internalResponse.candles].sort((a, b) => a.timestamp - b.timestamp);
  const chainlinkCandles = [...chainlinkResponse.candles].sort((a, b) => a.timestamp - b.timestamp);
  const metrics = computeMetrics(internalCandles, chainlinkCandles);

  return {
    epochId,
    windowStart,
    windowEnd,
    candleCount: Math.min(internalCandles.length, chainlinkCandles.length),
    internalCandlesHash: internalResponse.hash,
    chainlinkCandlesHash: chainlinkResponse.hash,
    diffMerkleRoot: hashDiffPairs(internalCandles, chainlinkCandles),
    metrics
  };
}

export function metricValue(snapshot: PriceIntegritySnapshot, metric: MetricName): number {
  switch (metric) {
    case "ohlc_mae_bps":
      return snapshot.metrics.ohlcMaeBps;
    case "ohlc_p95_bps":
      return snapshot.metrics.ohlcP95Bps;
    case "ohlc_max_bps":
      return snapshot.metrics.ohlcMaxBps;
    case "direction_match_bps":
      return snapshot.metrics.directionMatchBps;
    case "outlier_count":
      return snapshot.metrics.outlierCount;
    case "score_bps":
      return snapshot.metrics.scoreBps;
  }
}
