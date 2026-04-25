// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// @title Errors - Shared custom errors for all Tapl contracts
// @notice This file contains all custom errors used across the protocol

// Access control errors
error Unauthorized(address caller);
error InvalidRoleAddress(string role);

// Input validation errors
error InvalidAmount();
error InvalidEpoch();
error InvalidWindow();
error InvalidBatchId();
error ZeroAddress();

// State errors
error AlreadyExists();
error AlreadyInitialized();
error NotFound();
error InsufficientBalance();
error InsufficientShares();
error InsufficientWithdrawable();
error NativeTransferFailed();
error InvalidSignature();
error SignatureExpired();

// Price integrity errors
error InvalidMetricBounds(string metric);
error ThresholdNotMet(uint256 scoreBps, uint256 requiredBps);
error StaleEpoch(uint256 provided, uint256 expected);

// Settlement errors
error DuplicateBatchId(bytes32 batchId);
error InvalidCommitWindow();

// Pool reserve errors
error InsufficientCollateral();
error SolvencyRatioTooLow(uint256 ratio, uint256 required);
error NoLiabilityToReport();

// Strategy errors
error InvalidVolatilityRegime();
error InvalidSpreadBps();
error InvalidMultiplier();
