// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// @title Events - Shared events for all Tapl contracts
// @notice This file contains all events used across the protocol

// Price integrity events
event PriceIntegrityBatchReported(
    uint256 indexed epochId,
    uint256 windowStart,
    uint256 candleCount,
    bytes32 internalCandlesHash,
    bytes32 chainlinkCandlesHash,
    uint256 ohlcMaeBps,
    uint256 ohlcP95Bps,
    uint256 ohlcMaxBps,
    uint256 directionMatchBps,
    uint256 outlierCount,
    uint256 scoreBps,
    bytes32 diffMerkleRoot
);

// Pool reserve events
event LPDeposited(address indexed lp, uint256 amount, uint256 sharesMinted);
event LPWithdrawn(address indexed lp, uint256 sharesBurned, uint256 amountReturned);
event TraderDeposited(address indexed trader, uint256 amount);
event TraderClaimed(address indexed trader, uint256 amount);
event WithdrawableSet(address indexed account, uint256 amount);
event SolvencyReported(
    uint256 indexed epochId,
    uint256 poolBalance,
    uint256 totalLiability,
    uint256 utilizationBps,
    uint256 maxSingleBetExposure
);
event ReserveAllocatedToDistributor(uint256 amount, address indexed receiver);

// Settlement events
event SettlementBatchCommitted(
    bytes32 indexed batchId,
    bytes32 merkleRoot,
    uint256 totalPayout,
    uint256 withdrawableCap,
    uint256 windowStart,
    uint256 windowEnd
);
event PaidMarked(address indexed account, uint256 amount);

// Strategy events
event VolatilityRegimeChanged(
    uint256 indexed regimeId,
    uint256 fortressSpreadBps,
    uint256 maxMultiplier
);

// LP distribution events
event CCIPDistributionRequested(
    uint256 indexed epochId,
    uint256 amount,
    uint64 dstChainSelector,
    address receiver
);
