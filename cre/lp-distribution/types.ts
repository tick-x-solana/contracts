// ==========================================================================
// LP Distribution Workflow Types
// ==========================================================================

import { z } from "zod";

// ========================================
// EVM Configuration
// ========================================

export const evmConfigSchema = z.object({
  chainSelectorName: z.string(),
  chainId: z.number(),
  lpDistributorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  gasLimit: z.string().optional(),
});

export type EvmConfig = z.infer<typeof evmConfigSchema>;

// ========================================
// Main Config
// ========================================

export const configSchema = z.object({
  appApiBaseUrl: z.string().url(),
  evms: z.array(evmConfigSchema),
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
// LP Distribution Types
// ========================================

export const lpShareSchema = z.object({
  lp: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  shares: z.string(), // bigint as string
});

export const distributionDestinationSchema = z.object({
  chainSelector: z.number().int().positive(),
  receiver: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(), // bigint as string
});

export const distributionBatchSchema = z.object({
  epochId: z.number().int().positive(),
  totalRewards: z.string(), // bigint as string
  snapshotBlock: z.number().int().positive(),
  lpShares: z.array(lpShareSchema),
  destinations: z.array(distributionDestinationSchema),
});

export type LPShare = z.infer<typeof lpShareSchema>;
export type DistributionDestination = z.infer<typeof distributionDestinationSchema>;
export type DistributionBatch = z.infer<typeof distributionBatchSchema>;

export interface DistributionResult {
  epochId: number;
  destination: DistributionDestination;
  txHash: string;
  status: "success" | "failed";
  error?: string;
}
