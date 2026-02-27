// ==========================================================================
// EVM Helpers for Tap.fun CRE Workflows
// ==========================================================================

import { 
  cre, 
  type Runtime, 
  getNetwork, 
  bytesToHex, 
  hexToBase64,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from "viem";
import { Config, EvmConfig } from "../types";

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
// Price Integrity Report Submission
// ========================================

export interface PriceIntegrityPayload {
  epochId: number;
  windowStart: number;
  candleCount: number;
  internalCandlesHash: `0x${string}`;
  chainlinkCandlesHash: `0x${string}`;
  ohlcMaeBps: number;
  ohlcP95Bps: number;
  ohlcMaxBps: number;
  directionMatchBps: number;
  outlierCount: number;
  scoreBps: number;
  diffMerkleRoot: `0x${string}`;
}

export const encodePriceIntegrityReport = (payload: PriceIntegrityPayload): `0x${string}` => {
  return encodeAbiParameters(
    parseAbiParameters([
      "uint256 epochId",
      "uint256 windowStart",
      "uint256 candleCount",
      "bytes32 internalCandlesHash",
      "bytes32 chainlinkCandlesHash",
      "uint256 ohlcMaeBps",
      "uint256 ohlcP95Bps",
      "uint256 ohlcMaxBps",
      "uint256 directionMatchBps",
      "uint256 outlierCount",
      "uint256 scoreBps",
      "bytes32 diffMerkleRoot",
    ]),
    [
      BigInt(payload.epochId),
      BigInt(payload.windowStart),
      BigInt(payload.candleCount),
      payload.internalCandlesHash,
      payload.chainlinkCandlesHash,
      BigInt(payload.ohlcMaeBps),
      BigInt(payload.ohlcP95Bps),
      BigInt(payload.ohlcMaxBps),
      BigInt(payload.directionMatchBps),
      BigInt(payload.outlierCount),
      BigInt(payload.scoreBps),
      payload.diffMerkleRoot,
    ]
  );
};

export const submitPriceIntegrityReport = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  payload: PriceIntegrityPayload
): string => {
  const evmClient = createEvmClient(evmConfig.chainSelectorName);
  const reportData = encodePriceIntegrityReport(payload);

  runtime.log(`Submitting price integrity report for epoch ${payload.epochId}`);
  runtime.log(`Score: ${payload.scoreBps} bps, Passed: ${payload.scoreBps >= 9000 && payload.ohlcP95Bps <= 50}`);

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
      receiver: evmConfig.priceIntegrityAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  const txHash = bytesToHex(writeResult.txHash ?? new Uint8Array(32));
  runtime.log(`Price integrity report submitted. Tx: ${txHash}`);

  return txHash;
};

// ========================================
// On-Chain Read Helpers
// ========================================

export const readLatestEpochId = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): Promise<number> => {
  const evmClient = createEvmClient(evmConfig.chainSelectorName);
  
  // This would call PriceIntegrity.latestEpochId()
  // For now, return 0 to indicate no prior reports
  // In production, this would use EVM read capability
  runtime.log(`Reading latest epoch from PriceIntegrity contract`);
  
  // Placeholder - would be implemented with actual EVM read
  return 0;
};

export const readPoolBalance = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): Promise<bigint> => {
  runtime.log(`Reading pool balance from PoolReserve contract`);
  // Placeholder - would call PoolReserve.totalCollateral()
  return BigInt(0);
};

// ========================================
// Utility Functions
// ========================================

export const computeMerkleRoot = (leaves: `0x${string}`[]): `0x${string}` => {
  if (leaves.length === 0) {
    return keccak256(toHex(""));
  }

  // Simple Merkle root computation
  let currentLevel = leaves;
  
  while (currentLevel.length > 1) {
    const nextLevel: `0x${string}`[] = [];
    
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || left; // Duplicate last if odd
      const combined = keccak256(toHex(left + right.slice(2)));
      nextLevel.push(combined);
    }
    
    currentLevel = nextLevel;
  }

  return currentLevel[0];
};

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
