// ==========================================================================
// Settlement EVM Interaction Helpers
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
// Settlement Report Type
// ========================================

export interface SettlementReportPayload {
  batchId: `0x${string}`;
  merkleRoot: `0x${string}`;
  totalPayout: bigint;
  withdrawableCap: bigint;
  windowStart: number;
  windowEnd: number;
}

// ========================================
// Encode Settlement Report
// ========================================

export const encodeSettlementReport = (payload: SettlementReportPayload): `0x${string}` => {
  return encodeAbiParameters(
    parseAbiParameters([
      "bytes32 batchId",
      "bytes32 merkleRoot",
      "uint256 totalPayout",
      "uint256 withdrawableCap",
      "uint256 windowStart",
      "uint256 windowEnd",
    ]),
    [
      payload.batchId,
      payload.merkleRoot,
      payload.totalPayout,
      payload.withdrawableCap,
      BigInt(payload.windowStart),
      BigInt(payload.windowEnd),
    ]
  );
};

// ========================================
// Submit Settlement Batch
// ========================================

export const submitSettlementBatch = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  payload: SettlementReportPayload
): string => {
  const evmClient = createEvmClient(evmConfig.chainSelectorName);
  const reportData = encodeSettlementReport(payload);

  runtime.log(`Submitting settlement batch`);
  runtime.log(`Batch ID: ${payload.batchId}`);
  runtime.log(`Merkle Root: ${payload.merkleRoot}`);
  runtime.log(`Total Payout: ${payload.totalPayout.toString()}`);

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
      receiver: evmConfig.settlementAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  const txHash = bytesToHex(writeResult.txHash ?? new Uint8Array(32));
  runtime.log(`Settlement batch submitted. Tx: ${txHash}`);

  return txHash;
};
