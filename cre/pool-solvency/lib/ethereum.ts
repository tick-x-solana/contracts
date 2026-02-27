// ==========================================================================
// Pool Solvency EVM Interaction Helpers
// ==========================================================================

import { cre, type Runtime, getNetwork, bytesToHex, hexToBase64 } from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { Config, EvmConfig } from "../types";

// ========================================
// Retry Utility
// ========================================

export const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> => {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next retry (no delay in CRE WASM environment)
    }
  }
  
  throw lastError;
};

// ========================================
// EVM Client Factory
// ========================================

export const createEvmClient = (chainSelectorName: string, isTestnet = true) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName,
    isTestnet,
  });

  if (!network) {
    throw new Error(`Network not found: ${chainSelectorName}`);
  }

  return new cre.capabilities.EVMClient(network.chainSelector.selector);
};

// ========================================
// Solvency Report Type
// ========================================

export interface SolvencyReportPayload {
  epochId: number;
  poolBalance: bigint;
  totalLiability: bigint;
  utilizationBps: number;
  maxSingleBetExposure: bigint;
}

// ========================================
// Encode Solvency Report
// ========================================

export const encodeSolvencyReport = (payload: SolvencyReportPayload): `0x${string}` => {
  return encodeAbiParameters(
    parseAbiParameters([
      "uint256 epochId",
      "uint256 poolBalance",
      "uint256 totalLiability",
      "uint256 utilizationBps",
      "uint256 maxSingleBetExposure",
    ]),
    [
      BigInt(payload.epochId),
      payload.poolBalance,
      payload.totalLiability,
      BigInt(payload.utilizationBps),
      payload.maxSingleBetExposure,
    ]
  );
};

// ========================================
// Submit Solvency Report
// ========================================

export const submitSolvencyReport = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  payload: SolvencyReportPayload
): string => {
  const evmClient = createEvmClient(evmConfig.chainSelectorName);
  const reportData = encodeSolvencyReport(payload);

  runtime.log(`Submitting solvency report`);
  runtime.log(`Epoch ID: ${payload.epochId}`);
  runtime.log(`Pool Balance: ${payload.poolBalance.toString()}`);
  runtime.log(`Total Liability: ${payload.totalLiability.toString()}`);
  runtime.log(`Utilization: ${payload.utilizationBps} bps`);

  // Sign the report
  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  // Submit to contract
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: evmConfig.poolReserveAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  const txHash = bytesToHex(writeResult.txHash ?? new Uint8Array(32));
  runtime.log(`Solvency report submitted. Tx: ${txHash}`);

  return txHash;
};

// ========================================
// Read Pool Balance
// ========================================

export const readPoolBalance = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): bigint => {
  runtime.log(`Reading pool balance from PoolReserve`);
  
  // In a real implementation, this would use EVM read capability
  // For simulation, we return a mock value
  // The actual balance would be read via:
  // PoolReserve.totalCollateral() or asset.balanceOf(poolReserveAddress)
  
  // Return a simulated balance (e.g., 100,000 USDT worth)
  return BigInt(100000) * BigInt(1e18);
};

// ========================================
// Read Latest Solvency Epoch
// ========================================

export const readLatestSolvencyEpoch = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): number => {
  runtime.log(`Reading latest solvency epoch from PoolReserve`);
  
  // In a real implementation, this would call:
  // PoolReserve.latestSolvencyEpochId()
  
  // Return 0 for first run
  return 0;
};
