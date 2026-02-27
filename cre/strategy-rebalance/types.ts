// ==========================================================================
// Strategy Rebalance Workflow Types
// ==========================================================================

import { z } from "zod";

// ========================================
// EVM Configuration
// ========================================

export const evmConfigSchema = z.object({
  chainSelectorName: z.string(),
  chainId: z.number(),
  strategyManagerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  gasLimit: z.string().optional(),
});

export type EvmConfig = z.infer<typeof evmConfigSchema>;

// ========================================
// Auth Configuration
// ========================================

export const authConfigSchema = z.object({
  apiKeyHeader: z.string(),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

// ========================================
// Main Config
// ========================================

export const configSchema = z.object({
  appApiBaseUrl: z.string().url(),
  evms: z.array(evmConfigSchema),
  auth: authConfigSchema,
});

export type Config = z.infer<typeof configSchema>;

// ========================================
// Helper: Get EVM Config
// ========================================

export const getEvmConfig = (config: Config): EvmConfig => {
  if (config.evms.length === 0) {
    throw new Error("No EVM configuration found");
  }
  return config.evms[0];
};

// ========================================
// Strategy Types
// ========================================

export const volatilityRegimeSchema = z.object({
  regimeId: z.number().int().positive(),
  fortressSpreadBps: z.number().int().positive().max(10000), // Max 100%
  maxMultiplier: z.number().int().positive().max(1000), // Max 1000x
  effectiveTs: z.number().int().positive(),
  volatilityIndex: z.string(),
  regimeName: z.string(),
});

export type VolatilityRegime = z.infer<typeof volatilityRegimeSchema>;

// ========================================
// HTTP Request Payload
// ========================================

export const strategyUpdateRequestSchema = z.object({
  regimeId: z.number().int().positive(),
  fortressSpreadBps: z.number().int().positive().max(10000),
  maxMultiplier: z.number().int().positive().max(1000),
  apiKey: z.string().min(1),
});

export type StrategyUpdateRequest = z.infer<typeof strategyUpdateRequestSchema>;

// ========================================
// Response Types
// ========================================

export interface StrategyUpdateResult {
  success: boolean;
  regimeId: number;
  txHash?: string;
  error?: string;
  isNoOp: boolean;
}

// ========================================
// Validation Constants
// ========================================

export const VALIDATION = {
  MIN_FORTRESS_SPREAD_BPS: 1, // 0.01%
  MAX_FORTRESS_SPREAD_BPS: 10000, // 100%
  MIN_MAX_MULTIPLIER: 1,
  MAX_MAX_MULTIPLIER: 1000,
} as const;
