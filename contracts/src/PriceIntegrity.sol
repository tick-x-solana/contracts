// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Roles} from "./Roles.sol";
import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
import {Unauthorized, InvalidMetricBounds, StaleEpoch, InvalidAmount, ZeroAddress} from "./Errors.sol";
import {PriceIntegrityBatchReported} from "./Events.sol";

/// @title PriceIntegrity
/// @notice On-chain price integrity reporting for 15-minute batches of 1-second candles
/// @dev CRE submits batch comparisons via onReport; contract stores all valid submissions with pass/fail flags
contract PriceIntegrity is ReceiverTemplate {
    /// @notice Minimum score threshold (9000 bps = 90%)
    uint256 public constant MIN_SCORE_BPS = 9000;
    
    /// @notice Maximum allowed P95 deviation (50 bps = 0.5%)
    uint256 public constant MAX_OHLC_P95_BPS = 50;
    
    /// @notice Basis points denominator (10000 = 100%)
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Failure flag: Score below threshold
    uint8 public constant FLAG_LOW_SCORE = 1 << 0;
    
    /// @notice Failure flag: P95 deviation above threshold
    uint8 public constant FLAG_HIGH_P95 = 1 << 1;

    /// @notice Reference to the roles contract for access control
    Roles public immutable roles;

    /// @notice Latest submitted epoch ID (for monotonic enforcement)
    uint256 public latestEpochId;

    /// @notice Batch report data structure
    struct BatchReport {
        uint256 epochId;
        uint256 windowStart;
        uint256 candleCount;
        bytes32 internalCandlesHash;
        bytes32 chainlinkCandlesHash;
        uint256 ohlcMaeBps;
        uint256 ohlcP95Bps;
        uint256 ohlcMaxBps;
        uint256 directionMatchBps;
        uint256 outlierCount;
        uint256 scoreBps;
        bytes32 diffMerkleRoot;
        uint256 timestamp;
        bool isPassed;
        uint8 failureFlags;
    }

    /// @notice Stored reports by epoch ID
    mapping(uint256 => BatchReport) public reports;

    /// @notice Emitted when a batch comparison is submitted with result
    event BatchSubmitted(
        uint256 indexed epochId, 
        uint256 scoreBps, 
        uint256 ohlcP95Bps,
        bool isPassed, 
        uint8 failureFlags
    );

    modifier onlyReporter() {
        if (msg.sender != roles.reporter()) revert Unauthorized(msg.sender);
        _;
    }

    /// @param _roles Address of the Roles contract
    /// @param _forwarder Address of the Chainlink KeystoneForwarder contract
    constructor(address _roles, address _forwarder) ReceiverTemplate(_forwarder) {
        if (_roles == address(0)) revert ZeroAddress();
        roles = Roles(_roles);
    }

    /// @notice Process incoming price integrity reports from CRE workflow
    /// @param report ABI-encoded PriceIntegrityPayload
    function _processReport(bytes calldata report) internal override {
        // Decode report from workflow
        (
            uint256 epochId,
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
        ) = abi.decode(
            report, 
            (uint256, uint256, uint256, bytes32, bytes32, uint256, uint256, uint256, uint256, uint256, uint256, bytes32)
        );

        // Call internal submit logic
        _submitBatchComparison(
            epochId,
            windowStart,
            candleCount,
            internalCandlesHash,
            chainlinkCandlesHash,
            ohlcMaeBps,
            ohlcP95Bps,
            ohlcMaxBps,
            directionMatchBps,
            outlierCount,
            scoreBps,
            diffMerkleRoot
        );
    }

    /// @notice Submit a batch price comparison report from CRE (manual/legacy entry point)
    /// @dev Can still be called directly by reporter for testing/emergencies
    /// @param epochId Unique epoch identifier (must be monotonically increasing)
    /// @param windowStart Start timestamp of the comparison window
    /// @param candleCount Number of 1-second candles in the batch
    /// @param internalCandlesHash Hash of internal candle data
    /// @param chainlinkCandlesHash Hash of Chainlink candle data
    /// @param ohlcMaeBps Mean absolute error in basis points
    /// @param ohlcP95Bps 95th percentile error in basis points
    /// @param ohlcMaxBps Maximum error in basis points
    /// @param directionMatchBps Direction consistency in basis points (0-10000)
    /// @param outlierCount Number of candles with error > 50 bps
    /// @param scoreBps Overall quality score in basis points (0-10000)
    /// @param diffMerkleRoot Merkle root of candle differences
    function submitBatchComparison(
        uint256 epochId,
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
    ) external onlyReporter {
        _submitBatchComparison(
            epochId,
            windowStart,
            candleCount,
            internalCandlesHash,
            chainlinkCandlesHash,
            ohlcMaeBps,
            ohlcP95Bps,
            ohlcMaxBps,
            directionMatchBps,
            outlierCount,
            scoreBps,
            diffMerkleRoot
        );
    }

    /// @dev Internal function containing the actual submit logic
    function _submitBatchComparison(
        uint256 epochId,
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
    ) internal {
        // Validate epoch monotonicity
        if (epochId <= latestEpochId) {
            revert StaleEpoch(epochId, latestEpochId + 1);
        }

        // Validate candle count
        if (candleCount == 0) revert InvalidAmount();

        // Validate metric bounds (these are submission shape validations)
        if (directionMatchBps > BPS_DENOMINATOR) {
            revert InvalidMetricBounds("directionMatchBps");
        }
        if (outlierCount > candleCount) {
            revert InvalidMetricBounds("outlierCount");
        }

        // Compute pass/fail status and failure flags
        uint8 failureFlags = _computeFailureFlags(scoreBps, ohlcP95Bps);
        bool isPassed = failureFlags == 0;

        // Store the report (use memory to avoid stack too deep)
        BatchReport memory report = BatchReport({
            epochId: epochId,
            windowStart: windowStart,
            candleCount: candleCount,
            internalCandlesHash: internalCandlesHash,
            chainlinkCandlesHash: chainlinkCandlesHash,
            ohlcMaeBps: ohlcMaeBps,
            ohlcP95Bps: ohlcP95Bps,
            ohlcMaxBps: ohlcMaxBps,
            directionMatchBps: directionMatchBps,
            outlierCount: outlierCount,
            scoreBps: scoreBps,
            diffMerkleRoot: diffMerkleRoot,
            timestamp: block.timestamp,
            isPassed: isPassed,
            failureFlags: failureFlags
        });
        reports[epochId] = report;

        // Update latest epoch
        latestEpochId = epochId;

        // Emit events
        emit PriceIntegrityBatchReported(
            epochId,
            windowStart,
            candleCount,
            internalCandlesHash,
            chainlinkCandlesHash,
            ohlcMaeBps,
            ohlcP95Bps,
            ohlcMaxBps,
            directionMatchBps,
            outlierCount,
            scoreBps,
            diffMerkleRoot
        );

        emit BatchSubmitted(epochId, scoreBps, ohlcP95Bps, isPassed, failureFlags);
    }

    /// @notice Get a stored batch report by epoch ID
    /// @param epochId The epoch ID to query
    /// @return The batch report data
    function getReport(uint256 epochId) external view returns (BatchReport memory) {
        return reports[epochId];
    }

    /// @notice Get the latest batch report
    /// @return The latest batch report data
    function getLatestReport() external view returns (BatchReport memory) {
        return reports[latestEpochId];
    }

    /// @notice Check if a report would pass the quality gate (for external verification)
    /// @param scoreBps The score to check
    /// @param ohlcP95Bps The P95 deviation to check
    /// @return True if the report passes quality gates
    function passesQualityGate(uint256 scoreBps, uint256 ohlcP95Bps) external pure returns (bool) {
        return scoreBps >= MIN_SCORE_BPS && ohlcP95Bps <= MAX_OHLC_P95_BPS;
    }

    /// @notice Compute failure flags for given metrics (off-chain helper)
    /// @param scoreBps The score to check
    /// @param ohlcP95Bps The P95 deviation to check
    /// @return failureFlags Bitmask of failure reasons
    function computeFailureFlags(uint256 scoreBps, uint256 ohlcP95Bps) external pure returns (uint8) {
        return _computeFailureFlags(scoreBps, ohlcP95Bps);
    }

    /// @dev Internal function to compute failure flags
    function _computeFailureFlags(uint256 scoreBps, uint256 ohlcP95Bps) internal pure returns (uint8) {
        uint8 flags = 0;
        if (scoreBps < MIN_SCORE_BPS) {
            flags |= FLAG_LOW_SCORE;
        }
        if (ohlcP95Bps > MAX_OHLC_P95_BPS) {
            flags |= FLAG_HIGH_P95;
        }
        return flags;
    }
}
