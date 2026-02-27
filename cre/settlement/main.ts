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
  HTTPClient,
  handler,
  consensusIdenticalAggregation,
  ok,
  json,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type SettlementBatch, type EvmConfig, getEvmConfig } from "./types";
import { submitSettlementBatch } from "./lib/ethereum";
import { computeMerkleRoot, hashSettlement } from "./lib/hash";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

// ========================================
// Batch Processing
// ========================================

const computeTotalPayout = (batch: SettlementBatch): bigint => {
  return batch.settlements.reduce((total, settlement) => {
    if (settlement.outcome === "WIN") {
      return total + BigInt(settlement.payout);
    }
    return total;
  }, 0n);
};

const computeWithdrawableCap = (batch: SettlementBatch): bigint => {
  return batch.settlements.reduce((max, settlement) => {
    const payout = BigInt(settlement.payout);
    return payout > max ? payout : max;
  }, 0n);
};

const generateBatchId = (batch: SettlementBatch): `0x${string}` => {
  const data = encodeAbiParameters(
    parseAbiParameters("uint256 windowStart, uint256 windowEnd, uint256 settlementCount"),
    [BigInt(batch.windowStart), BigInt(batch.windowEnd), BigInt(batch.settlements.length)]
  );
  return keccak256(data);
};

const buildSettlementLeaves = (batch: SettlementBatch): `0x${string}`[] => {
  const sortedSettlements = [...batch.settlements].sort((a, b) => 
    a.account.localeCompare(b.account)
  );

  const seen = new Set<string>();
  const uniqueSettlements = sortedSettlements.filter(s => {
    const key = `${s.account}-${s.betId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueSettlements.map(hashSettlement);
};

// ========================================
// HTTP Fetch Functions
// ========================================

const fetchPendingBatches = (
  runtime: Runtime<Config>,
  apiKey: string,
  windowStart: number,
  windowEnd: number
): { batches: SettlementBatch[] } => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/settlement/batches/pending?windowStart=${windowStart}&windowEnd=${windowEnd}`;
  
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

  return json(response) as { batches: SettlementBatch[] };
};

const markBatchCommitted = (
  runtime: Runtime<Config>,
  apiKey: string,
  batchId: string,
  txHash: string,
  merkleRoot: string
): void => {
  const client = new HTTPClient();
  const url = `${runtime.config.appApiBaseUrl}/settlement/batches/${batchId}/committed`;
  const bodyData = JSON.stringify({ txHash, merkleRoot, committedAt: Math.floor(Date.now() / 1000) });
  
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
    runtime.log(`Warning: Failed to mark batch committed: ${response.statusCode}`);
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
  runtime.log("Settlement Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  // Get API key from secrets (3-tier fallback)
  let apiKey = "";
  try {
    const secret = runtime.getSecret({ id: "APP_API_KEY" }).result();
    apiKey = secret.value;
  } catch (e) {
    const envKey = (runtime as any).secrets?.APP_API_KEY;
    if (envKey) {
      apiKey = envKey;
    } else {
      apiKey = "8d920faa0c"; // Fallback for simulation
    }
  }

  // Resolve window
  const windowEnd = Math.floor(triggerTimestamp / 900) * 900;
  const windowStart = windowEnd - 900;

  runtime.log(`Processing window: ${windowStart} - ${windowEnd}`);

  // Fetch pending batches
  runtime.log("Fetching pending settlement batches...");
  const batchesResponse = runtime.runInNodeMode(
    (nodeRuntime) => fetchPendingBatches(nodeRuntime, apiKey, windowStart, windowEnd),
    consensusIdenticalAggregation<{ batches: SettlementBatch[] }>()
  )().result();
  const batches = batchesResponse.batches;
  runtime.log(`Found ${batches.length} pending batches`);

  if (batches.length === 0) {
    runtime.log("No pending batches to process");
    return "No pending batches";
  }

  // Process each batch
  const evmConfig = getEvmConfig(runtime.config);
  const results: string[] = [];

  for (const batch of batches) {
    runtime.log(`----------------------------------------`);
    runtime.log(`Processing batch: ${batch.batchId}`);
    runtime.log(`Settlements: ${batch.settlements.length}`);

    const batchId = generateBatchId(batch);
    runtime.log(`Generated batch ID: ${batchId}`);

    runtime.log("Building Merkle tree...");
    const leaves = buildSettlementLeaves(batch);
    const merkleRoot = computeMerkleRoot(leaves);
    runtime.log(`Merkle root: ${merkleRoot}`);

    const totalPayout = computeTotalPayout(batch);
    const withdrawableCap = computeWithdrawableCap(batch);
    runtime.log(`Total payout: ${totalPayout.toString()}`);

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

    runtime.log("Marking batch committed...");
    runtime.runInNodeMode(
      (nodeRuntime) => {
        markBatchCommitted(nodeRuntime, apiKey, batch.batchId, txHash, merkleRoot);
        return "ok";
      },
      consensusIdenticalAggregation<string>()
    )().result();
    runtime.log("Batch marked committed");

    results.push(`Batch ${batch.batchId}: ${txHash}`);
  }

  runtime.log("========================================");
  runtime.log("Settlement Workflow Completed");
  runtime.log(`Processed ${results.length} batches`);
  runtime.log("========================================");

  return `Settlement batches committed: ${results.join(", ")}`;
};

// ========================================
// Workflow Initialization
// ========================================

const initWorkflow = (config: Config) => {
  console.log("Initializing Settlement Workflow");
  console.log(`API Base URL: ${config.appApiBaseUrl}`);

  return [handler(new CronCapability().trigger({ schedule: "*/15 * * * *" }), onCronTrigger)];
};

// ========================================
// Entry Point
// ========================================

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
