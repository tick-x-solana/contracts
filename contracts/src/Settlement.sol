// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Roles} from "./Roles.sol";
import {Unauthorized, InvalidAmount, ZeroAddress, DuplicateBatchId, InvalidWindow} from "./Errors.sol";
import {SettlementBatchCommitted, PaidMarked} from "./Events.sol";
import {PoolReserve} from "./PoolReserve.sol";
import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @title Settlement
/// @notice Settlement batch commitment and payout tracking
/// @dev CRE commits settlement outcomes; contract stores batch metadata and manages withdrawable updates
contract Settlement is ReceiverTemplate {
    /// @notice Reference to the roles contract for access control
    Roles public immutable roles;

    /// @notice Reference to the PoolReserve for setting withdrawable amounts
    PoolReserve public immutable poolReserve;

    /// @notice Settlement batch data structure
    struct Batch {
        bytes32 batchId;
        bytes32 merkleRoot;
        uint256 totalPayout;
        uint256 withdrawableCap;
        uint256 windowStart;
        uint256 windowEnd;
        uint256 timestamp;
        bool exists;
    }

    /// @notice Stored batches by batch ID
    mapping(bytes32 => Batch) public batches;

    /// @notice Tracks paid amounts per account per batch (batchId => account => paid)
    mapping(bytes32 => mapping(address => uint256)) public paidAmount;

    /// @notice Total number of batches committed
    uint256 public batchCount;

    modifier onlySettler() {
        if (msg.sender != roles.settler()) revert Unauthorized(msg.sender);
        _;
    }

    /// @notice Override onlyOwner to use Roles contract for access control
    modifier onlyOwner() override {
        if (msg.sender != roles.owner()) revert Unauthorized(msg.sender);
        _;
    }

    /// @param _roles Address of the Roles contract
    /// @param _poolReserve Address of the PoolReserve contract
    /// @param _forwarder Address of the Chainlink Forwarder contract
    constructor(address _roles, address _poolReserve, address _forwarder) ReceiverTemplate(_forwarder) {
        if (_roles == address(0)) revert ZeroAddress();
        if (_poolReserve == address(0)) revert ZeroAddress();
        roles = Roles(_roles);
        poolReserve = PoolReserve(_poolReserve);
    }

    /// @notice Commit a settlement batch (called by owner)
    /// @param batchId Unique batch identifier (e.g., keccak256 of window data)
    /// @param merkleRoot Merkle root of settlement outcomes
    /// @param totalPayout Total payout amount for this batch
    /// @param withdrawableCap New withdrawable cap per account (or global cap logic)
    /// @param windowStart Start timestamp of the settlement window
    /// @param windowEnd End timestamp of the settlement window
    function commitSettlementBatch(
        bytes32 batchId,
        bytes32 merkleRoot,
        uint256 totalPayout,
        uint256 withdrawableCap,
        uint256 windowStart,
        uint256 windowEnd
    ) external onlyOwner {
        _commitSettlementBatch(batchId, merkleRoot, totalPayout, withdrawableCap, windowStart, windowEnd);
    }

    /// @notice Internal function to commit a settlement batch
    /// @param batchId Unique batch identifier (e.g., keccak256 of window data)
    /// @param merkleRoot Merkle root of settlement outcomes
    /// @param totalPayout Total payout amount for this batch
    /// @param withdrawableCap New withdrawable cap per account (or global cap logic)
    /// @param windowStart Start timestamp of the settlement window
    /// @param windowEnd End timestamp of the settlement window
    function _commitSettlementBatch(
        bytes32 batchId,
        bytes32 merkleRoot,
        uint256 totalPayout,
        uint256 withdrawableCap,
        uint256 windowStart,
        uint256 windowEnd
    ) internal {
        if (batchId == bytes32(0)) revert InvalidAmount();
        if (batches[batchId].exists) revert DuplicateBatchId(batchId);
        if (windowEnd <= windowStart) revert InvalidWindow();

        // Store the batch
        batches[batchId] = Batch({
            batchId: batchId,
            merkleRoot: merkleRoot,
            totalPayout: totalPayout,
            withdrawableCap: withdrawableCap,
            windowStart: windowStart,
            windowEnd: windowEnd,
            timestamp: block.timestamp,
            exists: true
        });

        batchCount++;

        emit SettlementBatchCommitted(
            batchId,
            merkleRoot,
            totalPayout,
            withdrawableCap,
            windowStart,
            windowEnd
        );
    }

    /// @notice Process a report from the Chainlink Forwarder
    /// @param report The raw report data containing encoded settlement batch params
    function _processReport(bytes calldata report) internal override {
        (
            bytes32 batchId,
            bytes32 merkleRoot,
            uint256 totalPayout,
            uint256 withdrawableCap,
            uint256 windowStart,
            uint256 windowEnd
        ) = abi.decode(report, (bytes32, bytes32, uint256, uint256, uint256, uint256));

        _commitSettlementBatch(batchId, merkleRoot, totalPayout, withdrawableCap, windowStart, windowEnd);
    }

    /// @notice Get a stored batch by batch ID
    /// @param batchId The batch ID to query
    /// @return The batch data
    function getBatch(bytes32 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }

    /// @notice Mark a payout as paid for PoC accounting (called by settler)
    /// @param account Account to mark as paid
    /// @param amount Amount paid
    /// @param batchId Batch ID for context
    function markPaid(address account, uint256 amount, bytes32 batchId) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (!batches[batchId].exists) revert InvalidAmount();

        paidAmount[batchId][account] += amount;

        emit PaidMarked(account, amount);
    }

    /// @notice Get paid amount for an account in a specific batch
    /// @param batchId The batch ID
    /// @param account The account to query
    /// @return Amount paid to the account in this batch
    function getPaidAmount(bytes32 batchId, address account) external view returns (uint256) {
        return paidAmount[batchId][account];
    }

    /// @notice Set withdrawable amount for an account via PoolReserve hook
    /// @param account Account to set withdrawable for
    /// @param amount New withdrawable amount
    function setWithdrawableViaPoolReserve(address account, uint256 amount) external onlyOwner {
        poolReserve.setWithdrawable(account, amount);
    }

    /// @notice Batch set withdrawable amounts for multiple accounts (gas optimization)
    /// @param accounts Array of accounts
    /// @param amounts Array of withdrawable amounts (must match accounts length)
    function batchSetWithdrawable(address[] calldata accounts, uint256[] calldata amounts) external onlyOwner {
        if (accounts.length != amounts.length) revert InvalidAmount();
        if (accounts.length == 0) revert InvalidAmount();

        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            poolReserve.setWithdrawable(accounts[i], amounts[i]);
        }
    }
}
