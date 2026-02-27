// ==========================================================================
// Workflow 2: Settlement (15m Batch Commitment)
// ==========================================================================
//
// This workflow:
// 1. Triggers every 15 minutes via cron
// 2. Fetches pending settlement batches from API
// 3. Canonicalizes settlement data (sort, dedupe)
// 4. Builds Merkle tree of settlement outcomes
// 5. Submits batch commitment on-chain
// 6. Marks batch committed via API callback
//
// Trigger: cron (*/15 * * * *)
// Contract: Settlement.commitSettlementBatch(...)
//
// REAL CONTRACT: 0xDce6601eb0cbbb93a5506644C1e527293FC3F3F6 (Sepolia)
// To use real contract: cre workflow simulate settlement --target sepolia-real --broadcast

import {
  CronCapability,
  handler,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type SettlementBatch, type EvmConfig, getEvmConfig } from "./types";
import { createApiClient } from "./lib/api";
import { submitSettlementBatch, withRetry } from "./lib/ethereum";
import { computeMerkleRoot, hashSettlement } from "./lib/hash";
import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";

// ========================================
// Batch Processing
// ========================================

/**
 * Compute total payout for a batch
 */
const computeTotalPayout = (batch: SettlementBatch): bigint => {
  return batch.settlements.reduce((total, settlement) => {
    if (settlement.outcome === "WIN") {
      return total + BigInt(settlement.payout);
    }
    return total;
  }, 0n);
};

/**
 * Compute withdrawable cap (max single payout in batch)
 */
const computeWithdrawableCap = (batch: SettlementBatch): bigint => {
  return batch.settlements.reduce((max, settlement) => {
    const payout = BigInt(settlement.payout);
    return payout > max ? payout : max;
  }, 0n);
};

/**
 * Generate deterministic batch ID
 */
const generateBatchId = (batch: SettlementBatch): `0x${string}` => {
  const data = encodeAbiParameters(
    parseAbiParameters("uint256 windowStart, uint256 windowEnd, uint256 settlementCount"),
    [BigInt(batch.windowStart), BigInt(batch.windowEnd), BigInt(batch.settlements.length)]
  );
  return keccak256(data);
};

/**
 * Build settlement leaves for Merkle tree
 */
const buildSettlementLeaves = (batch: SettlementBatch): `0x${string}`[] => {
  // Sort settlements by account for determinism
  const sortedSettlements = [...batch.settlements].sort((a, b) => 
    a.account.localeCompare(b.account)
  );

  // Remove duplicates (same account + betId)
  const seen = new Set<string>();
  const uniqueSettlements = sortedSettlements.filter(s => {
    const key = `${s.account}-${s.betId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Hash each settlement
  return uniqueSettlements.map(hashSettlement);
};

// ========================================
// Cron Trigger Handler
// ========================================

const onCronTrigger = async (
  runtime: Runtime<Config>,
  payload: CronPayload
): Promise<string> => {
  // Extract timestamp
  let triggerTimestamp = Math.floor(Date.now() / 1000);
  if (payload.scheduledExecutionTime?.seconds) {
    triggerTimestamp = Number(payload.scheduledExecutionTime.seconds);
  }

  runtime.log("========================================");
  runtime.log("Settlement Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  try {
    // ========================================
    // Step 1: Resolve Target Window
    // ========================================

    // Previous 15-minute window
    const windowEnd = Math.floor(triggerTimestamp / 900) * 900;
    const windowStart = windowEnd - 900;

    runtime.log(`Processing window: ${windowStart} - ${windowEnd}`);

    // ========================================
    // Step 2: Fetch Pending Batches
    // ========================================

    const apiKey = (runtime as any).secrets?.APP_API_KEY || "mock-key";
    const apiClient = createApiClient(
      runtime.config.appApiBaseUrl,
      apiKey,
      runtime.config.appApiBaseUrl.includes("localhost")
    );

    runtime.log("Fetching pending settlement batches...");
    const batches = await withRetry(() =>
      apiClient.getPendingSettlementBatches(windowStart, windowEnd)
    );
    runtime.log(`Found ${batches.length} pending batches`);

    if (batches.length === 0) {
      runtime.log("No pending batches to process");
      return "No pending batches";
    }

    // ========================================
    // Step 3: Process Each Batch
    // ========================================

    const evmConfig = getEvmConfig(runtime.config);
    const results: string[] = [];

    for (const batch of batches) {
      runtime.log(`----------------------------------------`);
      runtime.log(`Processing batch: ${batch.batchId}`);
      runtime.log(`Settlements: ${batch.settlements.length}`);
      runtime.log(`Deposits: ${batch.deposits.length}`);
      runtime.log(`Withdrawals: ${batch.withdrawals.length}`);

      // Generate deterministic batch ID
      const batchId = generateBatchId(batch);
      runtime.log(`Generated batch ID: ${batchId}`);

      // ========================================
      // Step 4: Canonicalize and Build Merkle Tree
      // ========================================

      runtime.log("Building Merkle tree...");
      const leaves = buildSettlementLeaves(batch);
      const merkleRoot = computeMerkleRoot(leaves);
      runtime.log(`Merkle root: ${merkleRoot}`);

      // ========================================
      // Step 5: Compute Financials
      // ========================================

      const totalPayout = computeTotalPayout(batch);
      const withdrawableCap = computeWithdrawableCap(batch);

      runtime.log(`Total payout: ${totalPayout.toString()}`);
      runtime.log(`Withdrawable cap: ${withdrawableCap.toString()}`);

      // ========================================
      // Step 6: Submit On-Chain
      // ========================================

      const reportPayload = {
        batchId,
        merkleRoot,
        totalPayout,
        withdrawableCap,
        windowStart: batch.windowStart,
        windowEnd: batch.windowEnd,
      };

      runtime.log("Submitting settlement batch on-chain...");
      const txHash = submitSettlementBatch(runtime, evmConfig, reportPayload);
      runtime.log(`Transaction: ${txHash}`);

      // ========================================
      // Step 7: Mark Batch Committed via API
      // ========================================

      runtime.log("Marking batch committed...");
      await withRetry(() =>
        apiClient.markBatchCommitted(batch.batchId, txHash, merkleRoot)
      );
      runtime.log("Batch marked committed");

      results.push(`Batch ${batch.batchId}: ${txHash}`);
    }

    runtime.log("========================================");
    runtime.log("Settlement Workflow Completed");
    runtime.log(`Processed ${results.length} batches`);
    runtime.log("========================================");

    return `Settlement batches committed: ${results.join(", ")}`;

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
  console.log("Initializing Settlement Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  // Cron trigger every 15 minutes
  const cronTrigger = new CronCapability().trigger({
    schedule: "*/15 * * * *",
  });

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
