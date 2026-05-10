export interface Candle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface OhlcResponse {
  windowStart: number;
  windowEnd: number;
  candles: Candle[];
  count: number;
  hash: `0x${string}`;
}

export interface ComputedMetrics {
  ohlcMaeBps: number;
  ohlcP95Bps: number;
  ohlcMaxBps: number;
  directionMatchBps: number;
  outlierCount: number;
  scoreBps: number;
}

export interface PriceIntegritySnapshot {
  epochId: number;
  windowStart: number;
  windowEnd: number;
  candleCount: number;
  internalCandlesHash: `0x${string}`;
  chainlinkCandlesHash: `0x${string}`;
  diffMerkleRoot: `0x${string}`;
  metrics: ComputedMetrics;
}

export type MetricName =
  | "ohlc_mae_bps"
  | "ohlc_p95_bps"
  | "ohlc_max_bps"
  | "direction_match_bps"
  | "outlier_count"
  | "score_bps";

export interface WorkerConfig {
  appApiBaseUrl: string;
  appApiKey: string;
  outlierThresholdBps: number;
  minScoreBps: number;
  maxOhlcP95Bps: number;
}
