// ==========================================================================
// Settlement Hashing Utilities
// ==========================================================================

import { keccak256, toHex, encodeAbiParameters, parseAbiParameters } from "viem";
import type { Settlement, SettlementBatch } from "../types";

// ========================================
// Settlement Hashing
// ========================================

/**
 * Hash a single settlement for Merkle tree leaf
 */
export const hashSettlement = (settlement: Settlement): `0x${string}` => {
  const data = encodeAbiParameters(
    parseAbiParameters(
      "address account, string betId, string outcome, uint256 payout, uint256 originalStake"
    ),
    [
      settlement.account as `0x${string}`,
      settlement.betId,
      settlement.outcome,
      BigInt(settlement.payout),
      BigInt(settlement.originalStake),
    ]
  );
  return keccak256(data);
};

/**
 * Compute Merkle root from leaves
 */
export const computeMerkleRoot = (leaves: `0x${string}`[]): `0x${string}` => {
  if (leaves.length === 0) {
    return keccak256(toHex(""));
  }

  let currentLevel = [...leaves];

  while (currentLevel.length > 1) {
    const nextLevel: `0x${string}`[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1] || left; // Duplicate last leaf if odd number

      // Sort to ensure deterministic ordering
      const sorted = [left, right].sort();
      const combined = encodeAbiParameters(
        parseAbiParameters("bytes32 left, bytes32 right"),
        [sorted[0] as `0x${string}`, sorted[1] as `0x${string}`]
      );
      nextLevel.push(keccak256(combined));
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0];
};

/**
 * Hash a full settlement batch
 */
export const hashSettlementBatch = (batch: SettlementBatch): `0x${string}` => {
  const data = encodeAbiParameters(
    parseAbiParameters(
      "string batchId, uint256 windowStart, uint256 windowEnd, uint256 settlementCount"
    ),
    [
      batch.batchId,
      BigInt(batch.windowStart),
      BigInt(batch.windowEnd),
      BigInt(batch.settlements.length),
    ]
  );
  return keccak256(data);
};

/**
 * Generate idempotency key for settlement batch
 */
export const settlementIdempotencyKey = (batchId: string): string => {
  return `settlement:${batchId}`;
};
