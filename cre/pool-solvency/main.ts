// ==========================================================================
// Workflow 3: Pool Solvency PoR (Daily Proof-of-Reserve)
// ==========================================================================
//
// This workflow:
// 1. Triggers daily via cron
// 2. Reads on-chain pool balance
// 3. Fetches liability data from API
// 4. Calculates solvency ratio
// 5. Submits report on-chain (only if ratio >= 1.5x)
// 6. Alerts on under-collateralization
//
// Trigger: cron (daily at 00:00 UTC)
// Contract: PoolReserve.reportSolvency(...)

import {
  CronCapability,
  handler,
  type Runtime,
  type CronPayload,
  Runner,
} from "@chainlink/cre-sdk";
import { type Config, type EvmConfig, getEvmConfig, MIN_SOLVENCY_RATIO, RATIO_PRECISION } from "./types";
import { createApiClient } from "./lib/api";
import { submitSolvencyReport, readPoolBalance, readLatestSolvencyEpoch, withRetry } from "./lib/ethereum";

// ========================================
// Solvency Calculation
// ========================================

/**
 * Calculate solvency ratio with 1e18 precision
 */
const calculateSolvencyRatio = (poolBalance: bigint, totalLiability: bigint): bigint => {
  if (totalLiability === 0n) {
    return BigInt(Number.MAX_SAFE_INTEGER); // Infinite solvency when no liability
  }
  return (poolBalance * RATIO_PRECISION) / totalLiability;
};

/**
 * Format ratio for display (e.g., 1.5e18 -> "1.50x")
 */
const formatRatio = (ratio: bigint): string => {
  const integerPart = ratio / RATIO_PRECISION;
  const fractionalPart = (ratio % RATIO_PRECISION) * 100n / RATIO_PRECISION;
  return `${integerPart}.${fractionalPart.toString().padStart(2, "0")}x`;
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
  runtime.log("Pool Solvency PoR Workflow Started");
  runtime.log(`Trigger time: ${new Date(triggerTimestamp * 1000).toISOString()}`);
  runtime.log("========================================");

  try {
    // ========================================
    // Step 1: Read On-Chain Pool Balance
    // ========================================

    const evmConfig = getEvmConfig(runtime.config);
    
    runtime.log("Reading pool balance from chain...");
    const poolBalance = await withRetry(() => readPoolBalance(runtime, evmConfig));
    runtime.log(`Pool balance: ${poolBalance.toString()}`);

    // ========================================
    // Step 2: Fetch Liability Data from API
    // ========================================

    const apiKey = (runtime as any).secrets?.APP_API_KEY || "mock-key";
    const apiClient = createApiClient(
      runtime.config.appApiBaseUrl,
      apiKey,
      runtime.config.appApiBaseUrl.includes("localhost")
    );

    runtime.log("Fetching liability data...");
    const liabilityData = await withRetry(() => apiClient.getLiabilityData());
    runtime.log(`Total liability: ${liabilityData.totalLiability}`);
    runtime.log(`Utilization: ${liabilityData.utilizationBps} bps`);
    runtime.log(`Max single bet exposure: ${liabilityData.maxSingleBetExposure}`);
    runtime.log(`Outstanding bets: ${liabilityData.outstandingBets}`);

    const totalLiability = BigInt(liabilityData.totalLiability);
    const maxSingleBetExposure = BigInt(liabilityData.maxSingleBetExposure);

    // ========================================
    // Step 3: Calculate Solvency Ratio
    // ========================================

    runtime.log("Calculating solvency ratio...");
    const solvencyRatio = calculateSolvencyRatio(poolBalance, totalLiability);
    const minRatio = runtime.config.minSolvencyRatio 
      ? BigInt(runtime.config.minSolvencyRatio)
      : MIN_SOLVENCY_RATIO;
    
    const isHealthy = solvencyRatio >= minRatio;

    runtime.log(`Solvency ratio: ${formatRatio(solvencyRatio)}`);
    runtime.log(`Minimum required: ${formatRatio(minRatio)}`);
    runtime.log(`Status: ${isHealthy ? "✅ HEALTHY" : "❌ UNDER-COLLATERALIZED"}`);

    // ========================================
    // Step 4: Alert on Under-Collateralization
    // ========================================

    if (!isHealthy) {
      const alertMessage = `CRITICAL: Pool solvency ratio ${formatRatio(solvencyRatio)} is below minimum ${formatRatio(minRatio)}. Pool balance: ${poolBalance.toString()}, Liability: ${totalLiability.toString()}`;
      
      runtime.log(`⚠️  ${alertMessage}`);
      
      // Send alert via API
      await apiClient.sendAlert(alertMessage, "critical");
      
      // Still continue to report the state on-chain for transparency
      runtime.log("Reporting under-collateralized state on-chain...");
    }

    // ========================================
    // Step 5: Generate Epoch ID
    // ========================================

    // Use days since epoch as epoch ID (daily reports)
    const epochId = Math.floor(triggerTimestamp / 86400);
    runtime.log(`Epoch ID: ${epochId} (day ${epochId})`);

    // Check for idempotency
    const latestEpoch = await withRetry(() => readLatestSolvencyEpoch(runtime, evmConfig));
    if (epochId <= latestEpoch) {
      runtime.log(`Epoch ${epochId} already reported (latest: ${latestEpoch}). Skipping.`);
      return `Epoch ${epochId} already reported`;
    }

    // ========================================
    // Step 6: Submit On-Chain Report
    // ========================================

    const reportPayload = {
      epochId,
      poolBalance,
      totalLiability,
      utilizationBps: liabilityData.utilizationBps,
      maxSingleBetExposure,
    };

    runtime.log("Submitting solvency report on-chain...");
    const txHash = submitSolvencyReport(runtime, evmConfig, reportPayload);

    runtime.log("========================================");
    runtime.log("Pool Solvency PoR Workflow Completed");
    runtime.log(`Transaction: ${txHash}`);
    runtime.log(`Status: ${isHealthy ? "HEALTHY" : "UNDER-COLLATERALIZED"}`);
    runtime.log("========================================");

    return `Solvency report submitted for epoch ${epochId}. Ratio: ${formatRatio(solvencyRatio)}, Status: ${isHealthy ? "HEALTHY" : "UNDER-COLLATERALIZED"}, Tx: ${txHash}`;

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
  console.log("Initializing Pool Solvency PoR Workflow");
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
