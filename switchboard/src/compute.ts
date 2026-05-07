import { workerConfig } from "./config.js";
import type { Candle, ComputedMetrics } from "./types.js";

function computeCandleError(internal: Candle, chainlink: Candle): number {
  const intOpen = Number(internal.open);
  const intHigh = Number(internal.high);
  const intLow = Number(internal.low);
  const intClose = Number(internal.close);

  const clOpen = Number(chainlink.open);
  const clHigh = Number(chainlink.high);
  const clLow = Number(chainlink.low);
  const clClose = Number(chainlink.close);

  const openErr = Math.abs((intOpen - clOpen) / clOpen) * 10000;
  const highErr = Math.abs((intHigh - clHigh) / clHigh) * 10000;
  const lowErr = Math.abs((intLow - clLow) / clLow) * 10000;
  const closeErr = Math.abs((intClose - clClose) / clClose) * 10000;

  return (openErr + highErr + lowErr + closeErr) / 4;
}

function computeDirectionMatch(internal: Candle, chainlink: Candle): boolean {
  const intOpen = Number(internal.open);
  const intClose = Number(internal.close);
  const clOpen = Number(chainlink.open);
  const clClose = Number(chainlink.close);

  return (intClose >= intOpen ? 1 : -1) === (clClose >= clOpen ? 1 : -1);
}

export function computeMetrics(
  internalCandles: Candle[],
  chainlinkCandles: Candle[]
): ComputedMetrics {
  const errors: number[] = [];
  let directionMatches = 0;
  let outlierCount = 0;

  const minLength = Math.min(internalCandles.length, chainlinkCandles.length);
  for (let i = 0; i < minLength; i += 1) {
    const error = computeCandleError(internalCandles[i], chainlinkCandles[i]);
    errors.push(error);

    if (error > workerConfig.outlierThresholdBps) outlierCount += 1;
    if (computeDirectionMatch(internalCandles[i], chainlinkCandles[i])) directionMatches += 1;
  }

  if (errors.length === 0) {
    return {
      ohlcMaeBps: 0,
      ohlcP95Bps: 0,
      ohlcMaxBps: 0,
      directionMatchBps: 0,
      outlierCount: 0,
      scoreBps: 0
    };
  }

  errors.sort((a, b) => a - b);
  const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const max = errors[errors.length - 1];
  const p95 = errors[Math.min(Math.floor(errors.length * 0.95), errors.length - 1)];
  const directionMatchBps = Math.floor((directionMatches / minLength) * 10000);
  const ohlcMaeBps = Math.floor(mae);
  const ohlcP95Bps = Math.floor(p95);
  const ohlcMaxBps = Math.floor(max);

  const weightAccuracy = 3000;
  const weightP95 = 2500;
  const weightMax = 1500;
  const weightDirection = 2000;
  const weightOutliers = 1000;

  const sAcc = Math.max(0, 10000 - ohlcMaeBps * 200);
  const sP95 = Math.max(0, 10000 - ohlcP95Bps * 100);
  const sMax = Math.max(0, 10000 - ohlcMaxBps * 50);
  const sDir = directionMatchBps;
  const outlierRateBps = minLength > 0 ? (outlierCount * 10000) / minLength : 0;
  const sOut = Math.max(0, 10000 - outlierRateBps * 2);

  const scoreBps = Math.floor(
    (weightAccuracy * sAcc +
      weightP95 * sP95 +
      weightMax * sMax +
      weightDirection * sDir +
      weightOutliers * sOut) /
      10000
  );

  return {
    ohlcMaeBps,
    ohlcP95Bps,
    ohlcMaxBps,
    directionMatchBps,
    outlierCount,
    scoreBps
  };
}
