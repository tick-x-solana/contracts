// ==========================================================================
// Settlement Workflow Types
// ==========================================================================

import { z } from "zod";

// ========================================
// EVM Configuration
// ========================================

export const evmConfigSchema = z.object({
  chainSelectorName: z.string(),
  chainId: z.number(),
  settlementAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  gasLimit: z.string().optional(),
});

export type EvmConfig = z.infer<typeof evmConfigSchema>;

// ========================================
// Main Config
// ========================================

export const configSchema = z.object({
  appApiBaseUrl: z.string().url(),
  evms: z.array(evmConfigSchema),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
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
// Settlement Types
// ========================================

export const settlementSchema = z.object({
  account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  betId: z.string(),
  outcome: z.enum(["WIN", "LOSE", "DRAW", "CANCELLED"]),
  payout: z.string(), // bigint as string
  originalStake: z.string(), // bigint as string
});

export const settlementBatchSchema = z.object({
  batchId: z.string(),
  windowStart: z.number(),
  windowEnd: z.number(),
  deposits: z.array(z.object({
    account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string(), // bigint as string
  })),
  withdrawals: z.array(z.object({
    account: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string(), // bigint as string
  })),
  settlements: z.array(settlementSchema),
});

export type Settlement = z.infer<typeof settlementSchema>;
export type SettlementBatch = z.infer<typeof settlementBatchSchema>;

export interface SettlementReport {
  batchId: `0x${string}`;
  merkleRoot: `0x${string}`;
  totalPayout: bigint;
  withdrawableCap: bigint;
  windowStart: number;
  windowEnd: number;
}
