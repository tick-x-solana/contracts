// ==========================================================================
// Shared Types and Schemas for Tapl CRE Workflows
// ==========================================================================

import { z } from "zod";

// ========================================
// Base Configuration Schema
// ========================================

export const evmConfigSchema = z.object({
  chainSelectorName: z.string().min(1),
  chainId: z.number().positive(),
  priceIntegrityAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  settlementAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  poolReserveAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  lpDistributorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  strategyManagerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  gasLimit: z.string().regex(/^\d+$/).refine(val => Number(val) > 0),
});

export const configSchema = z.object({
  appApiBaseUrl: z.string().url(),
  evms: z.array(evmConfigSchema).min(1),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
});

export type Config = z.infer<typeof configSchema>;
export type EvmConfig = z.infer<typeof evmConfigSchema>;

// ========================================
// OHLC Candle Types
// ========================================

export const candleSchema = z.object({
  timestamp: z.number().int().positive(),
  open: z.string().regex(/^\d+(\.\d+)?$/),
  high: z.string().regex(/^\d+(\.\d+)?$/),
  low: z.string().regex(/^\d+(\.\d+)?$/),
  close: z.string().regex(/^\d+(\.\d+)?$/),
});

export const ohlcResponseSchema = z.object({
  windowStart: z.number().int().positive(),
  windowEnd: z.number().int().positive(),
  candles: z.array(candleSchema),
  count: z.number().int().nonnegative(),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/i),
});

export type Candle = z.infer<typeof candleSchema>;
export type OhlcResponse = z.infer<typeof ohlcResponseSchema>;

// ========================================
// Price Integrity Types
// ========================================

export interface PriceIntegrityMetrics {
  ohlcMaeBps: number;        // Mean Absolute Error in bps
  ohlcP95Bps: number;        // 95th percentile error in bps
  ohlcMaxBps: number;        // Maximum error in bps
  directionMatchBps: number; // Direction consistency in bps (0-10000)
  outlierCount: number;      // Count of candles with error > 50 bps
}

export interface PriceIntegrityReport {
  epochId: number;
  windowStart: number;
  windowEnd: number;
  candleCount: number;
  internalCandlesHash: `0x${string}`;
  chainlinkCandlesHash: `0x${string}`;
  metrics: PriceIntegrityMetrics;
  scoreBps: number;
  isPassed: boolean;
  failureFlags: number;
  diffMerkleRoot: `0x${string}`;
}

// ========================================
// Settlement Types
// ========================================

export const depositSchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  amount: z.string().regex(/^\d+$/),
});

export const withdrawalSchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  amount: z.string().regex(/^\d+$/),
});

export const settlementSchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  betId: z.string(),
  outcome: z.enum(["WIN", "LOSE"]),
  payout: z.string().regex(/^\d+$/),
  originalStake: z.string().regex(/^\d+$/),
});

export const settlementBatchSchema = z.object({
  batchId: z.string(),
  windowStart: z.number().int().positive(),
  windowEnd: z.number().int().positive(),
  deposits: z.array(depositSchema),
  withdrawals: z.array(withdrawalSchema),
  settlements: z.array(settlementSchema),
});

export type SettlementBatch = z.infer<typeof settlementBatchSchema>;

export interface SettlementReport {
  batchId: `0x${string}`;
  merkleRoot: `0x${string}`;
  totalPayout: bigint;
  withdrawableCap: bigint;
  windowStart: number;
  windowEnd: number;
}

// ========================================
// Pool Solvency Types
// ========================================

export const liabilityResponseSchema = z.object({
  timestamp: z.number().int().positive(),
  totalLiability: z.string().regex(/^\d+$/),
  utilizationBps: z.number().int().min(0).max(10000),
  maxSingleBetExposure: z.string().regex(/^\d+$/),
  outstandingBets: z.number().int().nonnegative(),
});

export type LiabilityResponse = z.infer<typeof liabilityResponseSchema>;

export interface SolvencyReport {
  epochId: number;
  poolBalance: bigint;
  totalLiability: bigint;
  utilizationBps: number;
  maxSingleBetExposure: bigint;
  solvencyRatio: number; // 1.5 = 1.5x
}

// ========================================
// LP Distribution Types
// ========================================

export const lpShareSchema = z.object({
  lp: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  shares: z.string().regex(/^\d+$/),
});

export const distributionDestinationSchema = z.object({
  chainSelector: z.number().int().positive(),
  receiver: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
  amount: z.string().regex(/^\d+$/),
});

export const distributionBatchSchema = z.object({
  epochId: z.number().int().positive(),
  totalRewards: z.string().regex(/^\d+$/),
  snapshotBlock: z.number().int().positive(),
  lpShares: z.array(lpShareSchema),
  destinations: z.array(distributionDestinationSchema),
});

export type DistributionBatch = z.infer<typeof distributionBatchSchema>;

// ========================================
// Strategy Types
// ========================================

export const strategyRegimeSchema = z.object({
  regimeId: z.number().int().positive(),
  fortressSpreadBps: z.number().int().positive(),
  maxMultiplier: z.number().int().positive(),
  effectiveTs: z.number().int().positive(),
  volatilityIndex: z.string(),
  regimeName: z.string(),
});

export type StrategyRegime = z.infer<typeof strategyRegimeSchema>;

// ========================================
// API Response Types
// ========================================

export interface ApiError {
  error: string;
  message: string;
  retryable: boolean;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}
