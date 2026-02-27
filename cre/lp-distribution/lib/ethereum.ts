// ==========================================================================
// LP Distribution EVM Interaction Helpers
// ==========================================================================

import { cre, type Runtime, getNetwork, bytesToHex, hexToBase64 } from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { Config, EvmConfig, DistributionDestination } from "../types";

// ========================================
// Retry Utility
// ========================================

export const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
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
// Distribution Payload Type
// ========================================

export interface DistributionPayload {
  epochId: number;
  amount: bigint;
  dstChainSelector: bigint;
  receiver: `0x${string}`;
}

// ========================================
// Encode Distribution
// ========================================

export const encodeDistribution = (payload: DistributionPayload): `0x${string}` => {
  return encodeAbiParameters(
    parseAbiParameters([
      "uint256 epochId",
      "uint256 amount",
      "uint64 dstChainSelector",
      "address receiver",
    ]),
    [
      BigInt(payload.epochId),
      payload.amount,
      payload.dstChainSelector,
      payload.receiver,
    ]
  );
};

// ========================================
// Queue Distribution
// ========================================

export const queueDistribution = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  payload: DistributionPayload
): string => {
  const evmClient = createEvmClient(evmConfig.chainSelectorName);
  const reportData = encodeDistribution(payload);

  runtime.log(`Queueing distribution`);
  runtime.log(`Epoch ID: ${payload.epochId}`);
  runtime.log(`Amount: ${payload.amount.toString()}`);
  runtime.log(`Destination Chain: ${payload.dstChainSelector.toString()}`);
  runtime.log(`Receiver: ${payload.receiver}`);

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
      receiver: evmConfig.lpDistributorAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  const txHash = bytesToHex(writeResult.txHash ?? new Uint8Array(32));
  runtime.log(`Distribution queued. Tx: ${txHash}`);

  return txHash;
};

// ========================================
// Read Latest Distribution Epoch
// ========================================

export const readLatestDistributionEpoch = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): Promise<number> => {
  runtime.log(`Reading latest distribution epoch from LPDistributor`);
  
  // In a real implementation, this would call:
  // LPDistributor.latestEpochId()
  
  // Return 0 for first run
  return 0;
};

// ========================================
// Check if Distribution Exists
// ========================================

export const distributionExists = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  epochId: number
): Promise<boolean> => {
  runtime.log(`Checking if distribution exists for epoch ${epochId}`);
  
  // In a real implementation, this would call:
  // LPDistributor.requestExists(epochId)
  
  // Return false for simulation
  return false;
};
