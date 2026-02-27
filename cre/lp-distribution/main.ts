// ==========================================================================
// Workflow 4: LP Distribution (Daily Reward Distribution)
// ==========================================================================
//
// This workflow:
// 1. Triggers daily via cron
// 2. Fetches pending distribution batches from API
// 3. For each destination, queues distribution via LPDistributor
// 4. Calls PoolReserve.allocateReserveToLPDistributor() internally
// 5. Emits CCIPDistributionRequested event for each destination
// 6. Handles partial failures gracefully
//
// Trigger: cron (daily at 00:00 UTC)
// Contract: LPDistributor.queueDistribution(...)
//
// REAL CONTRACT: 0x32BC43d36EE16BaB6765A4447ED48DC3210969EC (Sepolia)
// To use real contract: cre workflow simulate lp-distribution --target sepolia-real --broadcast

import {
  CronCapability,
  handler,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type EvmConfig, type DistributionDestination, getEvmConfig } from "./types";
import { createApiClient, type DistributionResult } from "./lib/api";
import { queueDistribution, readLatestDistributionEpoch, distributionExists, withRetry } from "./lib/ethereum";

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
  runtime.log("LP Distribution Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  try {
    // ========================================
    // Step 1: Fetch Pending Distribution Batches
    // ========================================

    const apiKey = (runtime as any).secrets?.APP_API_KEY || "mock-key";
    const apiClient = createApiClient(
      runtime.config.appApiBaseUrl,
      apiKey,
      runtime.config.appApiBaseUrl.includes("localhost")
    );

    runtime.log("Fetching pending distribution batches...");
    const batches = await withRetry(() => apiClient.getPendingDistributionBatches());
    runtime.log(`Found ${batches.length} pending batches`);

    if (batches.length === 0) {
      runtime.log("No pending batches to process");
      return "No pending batches";
    }

    // ========================================
    // Step 2: Process Each Batch
    // ========================================

    const evmConfig = getEvmConfig(runtime.config);
    const allResults: DistributionResult[] = [];

    for (const batch of batches) {
      runtime.log(`----------------------------------------`);
      runtime.log(`Processing batch: epoch ${batch.epochId}`);
      runtime.log(`Total rewards: ${batch.totalRewards}`);
      runtime.log(`Snapshot block: ${batch.snapshotBlock}`);
      runtime.log(`LP shares count: ${batch.lpShares.length}`);
      runtime.log(`Destinations count: ${batch.destinations.length}`);

      // ========================================
      // Step 3: Check Idempotency
      // ========================================

      const exists = await withRetry(() => 
        distributionExists(runtime, evmConfig, batch.epochId)
      );
      
      if (exists) {
        runtime.log(`Distribution for epoch ${batch.epochId} already exists. Skipping.`);
        continue;
      }

      // ========================================
      // Step 4: Process Each Destination
      // ========================================

      const batchResults: DistributionResult[] = [];

      for (const destination of batch.destinations) {
        runtime.log(`Processing destination:`);
        runtime.log(`  Chain: ${destination.chainSelector}`);
        runtime.log(`  Receiver: ${destination.receiver}`);
        runtime.log(`  Amount: ${destination.amount}`);

        try {
          // ========================================
          // Step 5: Queue Distribution On-Chain
          // ========================================

          const distributionPayload = {
            epochId: batch.epochId,
            amount: BigInt(destination.amount),
            dstChainSelector: BigInt(destination.chainSelector),
            receiver: destination.receiver as `0x${string}`,
          };

          runtime.log("Queueing distribution on-chain...");
          const txHash = queueDistribution(runtime, evmConfig, distributionPayload);
          
          batchResults.push({
            epochId: batch.epochId,
            destination,
            txHash,
            status: "success",
          });
          
          runtime.log(`✅ Distribution queued. Tx: ${txHash}`);

        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          runtime.log(`❌ Failed to queue distribution: ${message}`);
          
          batchResults.push({
            epochId: batch.epochId,
            destination,
            txHash: "",
            status: "failed",
            error: message,
          });
          
          // Continue with next destination (partial failure handling)
          continue;
        }
      }

      // ========================================
      // Step 6: Report Results to API
      // ========================================

      const successCount = batchResults.filter(r => r.status === "success").length;
      const failedCount = batchResults.filter(r => r.status === "failed").length;

      runtime.log(`Batch ${batch.epochId} complete:`);
      runtime.log(`  Success: ${successCount}`);
      runtime.log(`  Failed: ${failedCount}`);

      try {
        await withRetry(() => apiClient.markBatchDistributed(batch.epochId, batchResults));
        runtime.log("Batch marked as distributed");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.log(`Warning: Failed to mark batch distributed: ${message}`);
        // Continue - this is a non-critical failure
      }

      allResults.push(...batchResults);
    }

    // ========================================
    // Step 7: Summary
    // ========================================

    const totalSuccess = allResults.filter(r => r.status === "success").length;
    const totalFailed = allResults.filter(r => r.status === "failed").length;

    runtime.log("========================================");
    runtime.log("LP Distribution Workflow Completed");
    runtime.log(`Total distributions: ${allResults.length}`);
    runtime.log(`Successful: ${totalSuccess}`);
    runtime.log(`Failed: ${totalFailed}`);
    runtime.log("========================================");

    if (totalFailed > 0) {
      return `LP distribution completed with ${totalFailed} failures. Successful: ${totalSuccess}, Failed: ${totalFailed}`;
    }

    return `All ${totalSuccess} distributions queued successfully`;

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
  console.log("Initializing LP Distribution Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  // Cron trigger - daily at 00:00 UTC
  const cronTrigger = new CronCapability().trigger({
    schedule: "0 0 * * *",
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
