// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Roles} from "./Roles.sol";
import {PoolReserve} from "./PoolReserve.sol";
import {Unauthorized, InvalidAmount, ZeroAddress} from "./Errors.sol";
import {CCIPDistributionRequested} from "./Events.sol";
import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";

/// @title LPDistributor
/// @notice LP distribution signaling and cross-chain distribution coordination
/// @dev Mock CCIP integration for PoC - emits events instead of actual bridge calls
contract LPDistributor is ReceiverTemplate {
    /// @notice Reference to the roles contract for access control
    Roles public immutable roles;

    /// @notice Reference to the PoolReserve for reserve allocation
    PoolReserve public immutable poolReserve;

    /// @notice Distribution request data structure
    struct DistributionRequest {
        uint256 epochId;
        uint256 amount;
        uint64 dstChainSelector;
        address receiver;
        uint256 timestamp;
        bool exists;
    }

    /// @notice Stored distribution requests by epoch ID
    mapping(uint256 => DistributionRequest) public requests;

    /// @notice Latest distribution epoch ID
    uint256 public latestEpochId;

    /// @notice Total number of distribution requests
    uint256 public requestCount;

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

    /// @notice Queue a distribution request (called by distributor)
    /// @dev For PoC: emits CCIPDistributionRequested event as mock (no actual bridge call)
    /// @param epochId Unique epoch identifier (must be monotonically increasing)
    /// @param amount Amount to distribute
    /// @param dstChainSelector CCIP destination chain selector
    /// @param receiver Receiver address on destination chain
    function queueDistribution(
        uint256 epochId,
        uint256 amount,
        uint64 dstChainSelector,
        address receiver
    ) external onlyOwner {
        _queueDistribution(epochId, amount, dstChainSelector, receiver);
    }

    /// @notice Internal function to queue a distribution request
    /// @param epochId Unique epoch identifier (must be monotonically increasing)
    /// @param amount Amount to distribute
    /// @param dstChainSelector CCIP destination chain selector
    /// @param receiver Receiver address on destination chain
    function _queueDistribution(
        uint256 epochId,
        uint256 amount,
        uint64 dstChainSelector,
        address receiver
    ) internal {
        if (epochId <= latestEpochId) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (receiver == address(0)) revert ZeroAddress();

        // Store the request
        requests[epochId] = DistributionRequest({
            epochId: epochId,
            amount: amount,
            dstChainSelector: dstChainSelector,
            receiver: receiver,
            timestamp: block.timestamp,
            exists: true
        });

        latestEpochId = epochId;
        requestCount++;

        // Mock CCIP: emit event only (no actual bridge call for PoC)
        emit CCIPDistributionRequested(epochId, amount, dstChainSelector, receiver);

        // Allocate reserve from PoolReserve
        poolReserve.allocateReserveToLPDistributor(amount, receiver);
    }

    /// @notice Process report from Chainlink workflow
    /// @param report The raw report data containing distribution parameters
    function _processReport(bytes calldata report) internal override {
        (
            uint256 epochId,
            uint256 amount,
            uint64 dstChainSelector,
            address receiver
        ) = abi.decode(report, (uint256, uint256, uint64, address));

        _queueDistribution(epochId, amount, dstChainSelector, receiver);
    }

    /// @notice Get a stored distribution request by epoch ID
    /// @param epochId The epoch ID to query
    /// @return The distribution request data
    function getRequest(uint256 epochId) external view returns (DistributionRequest memory) {
        return requests[epochId];
    }

    /// @notice Get the latest distribution request
    /// @return The latest distribution request data
    function getLatestRequest() external view returns (DistributionRequest memory) {
        return requests[latestEpochId];
    }

    /// @notice Check if a distribution request exists for an epoch
    /// @param epochId The epoch ID to check
    /// @return True if request exists
    function requestExists(uint256 epochId) external view returns (bool) {
        return requests[epochId].exists;
    }
}
