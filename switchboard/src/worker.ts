import { createHash } from "node:crypto";

import { fetchOhlcCandles } from "./api.js";
import { workerConfig } from "./config.js";
import { computeMetrics } from "./compute.js";
import type { Candle, ComputedMetrics, MetricName } from "./types.js";

export interface PriceIntegritySnapshot {
  epochId: number;
  windowStart: number;
  windowEnd: number;
  candleCount: number;
  internalCandlesHash: string;
  chainlinkCandlesHash: string;
  metrics: ComputedMetrics;
}

function resolveWindow(): { windowStart: number; windowEnd: number; epochId: number } {
  if (
    typeof workerConfig.simulationWindowStart === "number" &&
    typeof workerConfig.simulationWindowEnd === "number"
  ) {
    return {
      windowStart: workerConfig.simulationWindowStart,
      windowEnd: workerConfig.simulationWindowEnd,
      epochId: Math.floor(workerConfig.simulationWindowStart / 900)
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const windowEnd = Math.floor(now / 900) * 900;
  const windowStart = windowEnd - 900;
  return { windowStart, windowEnd, epochId: Math.floor(windowStart / 900) };
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function formatPrice(value: number): string {
  return value.toFixed(6);
}

function hashCandles(candles: Candle[]): `0x${string}` {
  const payload = JSON.stringify(candles);
  return `0x${createHash("sha256").update(payload).digest("hex")}`;
}

function buildSyntheticCandleSets(
  windowStart: number,
  candleCount: number
): { internalCandles: Candle[]; chainlinkCandles: Candle[] } {
  const internalCandles: Candle[] = [];
  const chainlinkCandles: Candle[] = [];
  let previousClose = randomFloat(95, 115);

  for (let index = 0; index < candleCount; index += 1) {
    const timestamp = windowStart + index;
    const baseOpen = previousClose;
    const drift = randomFloat(-0.0015, 0.0015);
    const baseClose = Math.max(1, baseOpen * (1 + drift));
    const wickUp = randomFloat(0.0001, 0.0012);
    const wickDown = randomFloat(0.0001, 0.0012);
    const baseHigh = Math.max(baseOpen, baseClose) * (1 + wickUp);
    const baseLow = Math.min(baseOpen, baseClose) * (1 - wickDown);

    const noise = randomFloat(-0.0007, 0.0007);
    const internalOpen = baseOpen * (1 + noise);
    const internalClose = baseClose * (1 + noise);
    const internalHigh = baseHigh * (1 + randomFloat(0, 0.0008));
    const internalLow = baseLow * (1 - randomFloat(0, 0.0008));

    chainlinkCandles.push({
      timestamp,
      open: formatPrice(baseOpen),
      high: formatPrice(baseHigh),
      low: formatPrice(baseLow),
      close: formatPrice(baseClose)
    });

    internalCandles.push({
      timestamp,
      open: formatPrice(internalOpen),
      high: formatPrice(Math.max(internalHigh, internalOpen, internalClose)),
      low: formatPrice(Math.min(internalLow, internalOpen, internalClose)),
      close: formatPrice(internalClose)
    });

    previousClose = baseClose;
  }

  return { internalCandles, chainlinkCandles };
}

export function buildSyntheticSnapshot(): PriceIntegritySnapshot {
  const { windowStart, windowEnd, epochId } = resolveWindow();
  const candleCount = 900;
  let internalCandles: Candle[] = [];
  let chainlinkCandles: Candle[] = [];
  let metrics: ComputedMetrics = {
    ohlcMaeBps: 0,
    ohlcP95Bps: 0,
    ohlcMaxBps: 0,
    directionMatchBps: 0,
    outlierCount: 0,
    scoreBps: 0
  };

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const generated = buildSyntheticCandleSets(windowStart, candleCount);
    const candidateMetrics = computeMetrics(generated.internalCandles, generated.chainlinkCandles);

    if (
      candidateMetrics.scoreBps >= workerConfig.minScoreBps &&
      candidateMetrics.ohlcP95Bps <= workerConfig.maxOhlcP95Bps
    ) {
      internalCandles = generated.internalCandles;
      chainlinkCandles = generated.chainlinkCandles;
      metrics = candidateMetrics;
      break;
    }
  }

  if (internalCandles.length === 0 || chainlinkCandles.length === 0) {
    throw new Error("failed to build passing synthetic candle sets");
  }

  return {
    epochId,
    windowStart,
    windowEnd,
    candleCount,
    internalCandlesHash: hashCandles(internalCandles),
    chainlinkCandlesHash: hashCandles(chainlinkCandles),
    metrics
  };
}

export async function computePriceIntegritySnapshot(): Promise<PriceIntegritySnapshot> {
  if (process.env.SWITCHBOARD_FAKE_METRICS !== "0") {
    return buildSyntheticSnapshot();
  }

  if (!workerConfig.appApiKey) {
    throw new Error("APP_API_KEY is required");
  }

  const { windowStart, windowEnd, epochId } = resolveWindow();
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
