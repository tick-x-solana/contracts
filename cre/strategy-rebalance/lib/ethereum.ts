// ==========================================================================
// Strategy Rebalance EVM Interaction Helpers
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
// Strategy Update Payload
// ========================================

export interface StrategyUpdatePayload {
  regimeId: number;
  fortressSpreadBps: number;
  maxMultiplier: number;
}

// ========================================
// Encode Strategy Update
// ========================================

export const encodeStrategyUpdate = (payload: StrategyUpdatePayload): `0x${string}` => {
  return encodeAbiParameters(
    parseAbiParameters([
      "uint256 regimeId",
      "uint256 fortressSpreadBps",
      "uint256 maxMultiplier",
    ]),
    [
      BigInt(payload.regimeId),
      BigInt(payload.fortressSpreadBps),
      BigInt(payload.maxMultiplier),
    ]
  );
};

// ========================================
// Set Volatility Regime
// ========================================

export const setVolatilityRegime = (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  payload: StrategyUpdatePayload
): string => {
  const evmClient = createEvmClient(evmConfig.chainSelectorName);
  const reportData = encodeStrategyUpdate(payload);

  runtime.log(`Setting volatility regime`);
  runtime.log(`Regime ID: ${payload.regimeId}`);
  runtime.log(`Fortress Spread: ${payload.fortressSpreadBps} bps`);
  runtime.log(`Max Multiplier: ${payload.maxMultiplier}x`);

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
      receiver: evmConfig.strategyManagerAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: evmConfig.gasLimit,
      },
    })
    .result();

  const txHash = bytesToHex(writeResult.txHash ?? new Uint8Array(32));
  runtime.log(`Volatility regime set. Tx: ${txHash}`);

  return txHash;
};

// ========================================
// Read Current Regime
// ========================================

export const readCurrentRegime = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): Promise<{ regimeId: number; fortressSpreadBps: number; maxMultiplier: number } | null> => {
  runtime.log(`Reading current regime from StrategyManager`);
  
  // In a real implementation, this would call:
  // StrategyManager.getCurrentRegime()
  
  // Return null for first run (no current regime)
  return null;
};

// ========================================
// Read Latest Regime ID
// ========================================

export const readLatestRegimeId = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig
): Promise<number> => {
  runtime.log(`Reading latest regime ID from StrategyManager`);
  
  // In a real implementation, this would call:
  // StrategyManager.latestRegimeId()
  
  // Return 0 for first run
  return 0;
};

// ========================================
// Check if Regime Exists
// ========================================

export const regimeExists = async (
  runtime: Runtime<Config>,
  evmConfig: EvmConfig,
  regimeId: number
): Promise<boolean> => {
  runtime.log(`Checking if regime ${regimeId} exists`);
  
  // In a real implementation, this would call:
  // StrategyManager.regimeExists(regimeId)
  
  // Return false for simulation
  return false;
};
