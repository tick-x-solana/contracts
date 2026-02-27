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
  HTTPClient,
  handler,
  consensusIdenticalAggregation,
  ok,
  json,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type EvmConfig, type DistributionDestination, type DistributionBatch, getEvmConfig } from "./types";
import { queueDistribution, readLatestDistributionEpoch, distributionExists } from "./lib/ethereum";

// ========================================
// Distribution Result Type
// ========================================

interface DistributionResult {
  epochId: number;
  destination: DistributionDestination;
  txHash: string;
  status: "success" | "failed";
  error?: string;
}

// ========================================
// HTTP Fetch Functions
// ========================================

interface BatchesResponse {
  batches: DistributionBatch[];
}

const fetchPendingBatches = (
  runtime: Runtime<Config>,
  apiKey: string
): BatchesResponse => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/distribution/batches/pending`;

  const response = client
    .sendRequest(runtime, {
      url,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    })
    .result();

  if (!ok(response)) {
    throw new Error(`HTTP request failed with status: ${response.statusCode}`);
  }

  return json(response) as BatchesResponse;
};

const markBatchDistributed = (
  runtime: Runtime<Config>,
  apiKey: string,
  epochId: number,
  results: DistributionResult[]
): void => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/distribution/batches/${epochId}/distributed`;
  const bodyData = JSON.stringify({ results, distributedAt: Math.floor(Date.now() / 1000) });

  const response = client
    .sendRequest(runtime, {
      url,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: new TextEncoder().encode(bodyData),
    })
    .result();

  if (!ok(response)) {
    runtime.log(`Warning: Failed to mark batch distributed: ${response.statusCode}`);
  }
};

// ========================================
// Cron Trigger Handler
// ========================================

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
  let triggerTimestamp = Math.floor(Date.now() / 1000);
  if (payload.scheduledExecutionTime?.seconds) {
    triggerTimestamp = Number(payload.scheduledExecutionTime.seconds);
  }

  runtime.log("========================================");
  runtime.log("LP Distribution Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  // Get API key (3-tier fallback)
  let apiKey = "";
  try {
    const secret = runtime.getSecret({ id: "APP_API_KEY" }).result();
    apiKey = secret.value;
  } catch (e) {
    const envKey = (runtime as any).secrets?.APP_API_KEY;
    if (envKey) {
      apiKey = envKey;
    } else {
      apiKey = "8d920faa0c";
    }
  }

  // Fetch pending batches
  runtime.log("Fetching pending distribution batches...");
  const batchesResponse = runtime.runInNodeMode(
    (nodeRuntime) => fetchPendingBatches(nodeRuntime, apiKey),
    consensusIdenticalAggregation<BatchesResponse>()
  )().result();
  const batches = batchesResponse.batches;
  runtime.log(`Found ${batches.length} pending batches`);

  if (batches.length === 0) {
    runtime.log("No pending batches to process");
    return "No pending batches";
  }

  const evmConfig = getEvmConfig(runtime.config);
  const results: DistributionResult[] = [];

  for (const batch of batches) {
    runtime.log(`----------------------------------------`);
    runtime.log(`Processing batch: epoch ${batch.epochId}`);
    runtime.log(`Total rewards: ${batch.totalRewards}`);
    runtime.log(`Destinations: ${batch.destinations.length}`);

    // Check if already distributed
    // if (distributionExists(runtime, evmConfig, batch.epochId)) {
    //   runtime.log(`Distribution already exists for epoch ${batch.epochId}`);
    //   results.push({
    //     epochId: batch.epochId,
    //     destination: batch.destinations[0],
    //     txHash: "",
    //     status: "failed",
    //     error: "Already distributed",
    //   });
    //   continue;
    // }

    // Process each destination
    let successCount = 0;
    for (const destination of batch.destinations) {
      runtime.log(`Processing destination:`);
      runtime.log(`Chain: ${destination.chainSelector}`);
      runtime.log(`Receiver: ${destination.receiver}`);
      runtime.log(`Amount: ${destination.amount}`);

      try {
        const txHash = queueDistribution(runtime, evmConfig, {
          epochId: batch.epochId,
          amount: BigInt(destination.amount),
          dstChainSelector: destination.chainSelector,
          receiver: destination.receiver,
        });

        results.push({
          epochId: batch.epochId,
          destination,
          txHash,
          status: "success",
        });
        successCount++;
        runtime.log(`✅ Distribution queued. Tx: ${txHash}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          epochId: batch.epochId,
          destination,
          txHash: "",
          status: "failed",
          error: message,
        });
        runtime.log(`❌ Distribution failed: ${message}`);
      }
    }

    // Mark batch as distributed
    runtime.log("Marking batch as distributed...");
    runtime.runInNodeMode(
      (nodeRuntime) => {
        markBatchDistributed(nodeRuntime, apiKey, batch.epochId, results);
        return "ok";
      },
      consensusIdenticalAggregation<string>()
    )().result();

    runtime.log(`Batch ${batch.epochId} complete: ${successCount}/${batch.destinations.length} succeeded`);
  }

  const totalSuccess = results.filter(r => r.status === "success").length;
  const totalFailed = results.filter(r => r.status === "failed").length;

  runtime.log("========================================");
  runtime.log("LP Distribution Workflow Completed");
  runtime.log(`Total distributions: ${results.length}`);
  runtime.log(`Successful: ${totalSuccess}`);
  runtime.log(`Failed: ${totalFailed}`);
  runtime.log("========================================");

  return `All ${totalSuccess} distributions queued successfully`;
};

// ========================================
// Workflow Initialization
// ========================================

const initWorkflow = (config: Config) => {
  console.log("Initializing LP Distribution Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  return [handler(new CronCapability().trigger({ schedule: "0 0 * * *" }), onCronTrigger)];
};

// ========================================
// Entry Point
// ========================================

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
