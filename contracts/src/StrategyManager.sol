// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Roles} from "./Roles.sol";
import {Unauthorized, InvalidAmount, ZeroAddress} from "./Errors.sol";
import {VolatilityRegimeChanged} from "./Events.sol";
import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";

/// @title StrategyManager
/// @notice Governance-controlled strategy parameter updates for Fortress behavior
/// @dev Manages volatility regime parameters that affect pricing and risk
contract StrategyManager is ReceiverTemplate {
    /// @notice Reference to the roles contract for access control
    Roles public immutable roles;

    /// @notice Volatility regime data structure
    struct VolatilityRegime {
        uint256 regimeId;
        uint256 fortressSpreadBps;
        uint256 maxMultiplier;
        uint256 timestamp;
        bool exists;
    }

    /// @notice Latest active regime ID
    uint256 public latestRegimeId;

    /// @notice Stored regimes by regime ID
    mapping(uint256 => VolatilityRegime) public regimes;

    /// @notice Current active regime (copy for quick access)
    VolatilityRegime public currentRegime;

    modifier onlyStrategist() {
        if (msg.sender != roles.strategist()) revert Unauthorized(msg.sender);
        _;
    }

    /// @param _roles Address of the Roles contract
    /// @param _forwarder Address of the Chainlink Forwarder contract
    constructor(address _roles, address _forwarder) ReceiverTemplate(_forwarder) {
        if (_roles == address(0)) revert ZeroAddress();
        roles = Roles(_roles);
    }

    /// @notice Set a new volatility regime (called by strategist)
    /// @param regimeId Unique regime identifier (must be monotonically increasing)
    /// @param fortressSpreadBps Fortress spread in basis points
    /// @param maxMultiplier Maximum allowed multiplier
    function setVolatilityRegime(
        uint256 regimeId,
        uint256 fortressSpreadBps,
        uint256 maxMultiplier
    ) external onlyStrategist {
        _setVolatilityRegime(regimeId, fortressSpreadBps, maxMultiplier);
    }

    /// @notice Internal function to set a new volatility regime
    /// @param regimeId Unique regime identifier (must be monotonically increasing)
    /// @param fortressSpreadBps Fortress spread in basis points
    /// @param maxMultiplier Maximum allowed multiplier
    function _setVolatilityRegime(
        uint256 regimeId,
        uint256 fortressSpreadBps,
        uint256 maxMultiplier
    ) internal {
        if (regimeId <= latestRegimeId) revert InvalidAmount();
        if (fortressSpreadBps == 0) revert InvalidAmount();
        if (maxMultiplier == 0) revert InvalidAmount();

        // Store the new regime
        regimes[regimeId] = VolatilityRegime({
            regimeId: regimeId,
            fortressSpreadBps: fortressSpreadBps,
            maxMultiplier: maxMultiplier,
            timestamp: block.timestamp,
            exists: true
        });

        // Update current regime
        currentRegime = regimes[regimeId];
        latestRegimeId = regimeId;

        emit VolatilityRegimeChanged(regimeId, fortressSpreadBps, maxMultiplier);
    }

    /// @notice Processes incoming reports from Chainlink workflows
    /// @param report The encoded report data
    /// @dev Decodes report and updates volatility regime parameters
    function _processReport(bytes calldata report) internal override {
        (
            uint256 regimeId,
            uint256 fortressSpreadBps,
            uint256 maxMultiplier
        ) = abi.decode(report, (uint256, uint256, uint256));

        _setVolatilityRegime(regimeId, fortressSpreadBps, maxMultiplier);
    }

    /// @notice Get a stored regime by ID
    /// @param regimeId The regime ID to query
    /// @return The regime data
    function getRegime(uint256 regimeId) external view returns (VolatilityRegime memory) {
        return regimes[regimeId];
    }

    /// @notice Get the current active regime
    /// @return The current regime data
    function getCurrentRegime() external view returns (VolatilityRegime memory) {
        return currentRegime;
    }

    /// @notice Check if a regime exists
    /// @param regimeId The regime ID to check
    /// @return True if regime exists
    function regimeExists(uint256 regimeId) external view returns (bool) {
        return regimes[regimeId].exists;
    }
}
