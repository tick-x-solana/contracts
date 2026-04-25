// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {PriceIntegrity} from "../src/PriceIntegrity.sol";
import {Roles} from "../src/Roles.sol";
import {ReceiverTemplate} from "../src/abstracts/ReceiverTemplate.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";
import {IERC165} from "../src/interfaces/IERC165.sol";
import {InvalidMetricBounds, StaleEpoch, InvalidAmount, ZeroAddress} from "../src/Errors.sol";
import {PriceIntegrityBatchReported} from "../src/Events.sol";

contract PriceIntegrityTest is Test {
    PriceIntegrity public priceIntegrity;
    Roles public roles;
    
    address public owner = address(1);
    address public reporter = address(2);
    address public randomUser = address(99);
    address public forwarder = address(100); // Mock forwarder for testing

    // Test data
    uint256 constant EPOCH_1 = 1;
    uint256 constant WINDOW_START = 1777014000;
    uint256 constant CANDLE_COUNT = 900; // 15 minutes of 1-second candles
    bytes32 constant INTERNAL_HASH = keccak256("internal_candles");
    bytes32 constant CHAINLINK_HASH = keccak256("chainlink_candles");
    uint256 constant MAE_BPS = 5;
    uint256 constant P95_BPS = 25; // Under 50 threshold
    uint256 constant MAX_BPS = 40;
    uint256 constant DIR_MATCH_BPS = 9800;
    uint256 constant OUTLIER_COUNT = 5;
    uint256 constant SCORE_BPS = 9500; // Over 9000 threshold
    bytes32 constant DIFF_ROOT = keccak256("diff_merkle_root");

    function setUp() public {
        // Deploy roles with owner as reporter for simplicity in tests
        vm.prank(owner);
        roles = new Roles(owner, reporter, address(0), address(0), address(0));
        
        // Deploy PriceIntegrity with forwarder
        priceIntegrity = new PriceIntegrity(address(roles), forwarder);
    }

    // ==================== Constructor Tests ====================

    function test_ConstructorSetsRoles() public view {
        assertEq(address(priceIntegrity.roles()), address(roles));
        assertEq(priceIntegrity.latestEpochId(), 0);
    }

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        new PriceIntegrity(address(0), forwarder);
    }

    // ==================== Happy Path Tests ====================

    function test_SubmitBatchComparison() public {
        vm.prank(reporter);
        
        vm.expectEmit(true, false, false, false);
        emit PriceIntegrityBatchReported(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        // Verify state updates
        assertEq(priceIntegrity.latestEpochId(), EPOCH_1);
        
        // Verify stored report
        PriceIntegrity.BatchReport memory report = priceIntegrity.getReport(EPOCH_1);
        assertEq(report.epochId, EPOCH_1);
        assertEq(report.windowStart, WINDOW_START);
        assertEq(report.candleCount, CANDLE_COUNT);
        assertEq(report.internalCandlesHash, INTERNAL_HASH);
        assertEq(report.chainlinkCandlesHash, CHAINLINK_HASH);
        assertEq(report.ohlcMaeBps, MAE_BPS);
        assertEq(report.ohlcP95Bps, P95_BPS);
        assertEq(report.ohlcMaxBps, MAX_BPS);
        assertEq(report.directionMatchBps, DIR_MATCH_BPS);
        assertEq(report.outlierCount, OUTLIER_COUNT);
        assertEq(report.scoreBps, SCORE_BPS);
        assertEq(report.diffMerkleRoot, DIFF_ROOT);
        assertEq(report.timestamp, block.timestamp);
        assertTrue(report.isPassed);
        assertEq(report.failureFlags, 0);
    }

    function test_GetLatestReport() public {
        vm.prank(reporter);
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        PriceIntegrity.BatchReport memory report = priceIntegrity.getLatestReport();
        assertEq(report.epochId, EPOCH_1);
    }

    // ==================== Auth Tests ====================

    function test_AnyCallerCanSubmit() public {
        vm.prank(randomUser);
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        PriceIntegrity.BatchReport memory report = priceIntegrity.getReport(EPOCH_1);
        assertEq(report.epochId, EPOCH_1);
    }

    // ==================== Monotonic Epoch Tests ====================

    function test_CannotSubmitStaleEpoch() public {
        // Submit epoch 1
        vm.prank(reporter);
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        // Try to submit epoch 1 again (should fail)
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(StaleEpoch.selector, EPOCH_1, EPOCH_1 + 1));
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );
    }

    function test_CannotSubmitEarlierEpoch() public {
        // Submit epoch 2 first
        vm.prank(reporter);
        priceIntegrity.submitBatchComparison(
            2,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        // Try to submit epoch 1 (should fail)
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(StaleEpoch.selector, EPOCH_1, 3));
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );
    }

    // ==================== Metric Bounds Tests ====================

    function test_InvalidDirectionMatchBps() public {
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(InvalidMetricBounds.selector, "directionMatchBps"));
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            10001, // Invalid: > 10000
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );
    }

    function test_InvalidOutlierCount() public {
        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(InvalidMetricBounds.selector, "outlierCount"));
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            CANDLE_COUNT + 1, // Invalid: > candleCount
            SCORE_BPS,
            DIFF_ROOT
        );
    }

    function test_ZeroCandleCountReverts() public {
        vm.prank(reporter);
        vm.expectRevert(InvalidAmount.selector);
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            0, // Invalid: zero candles
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );
    }

    // ==================== Threshold Tests (Store, Don't Revert) ====================

    function test_LowScoreStoresWithFailureFlag() public {
        // Get flag value first (doesn't affect prank)
        uint8 flag = priceIntegrity.FLAG_LOW_SCORE();
        
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit PriceIntegrity.BatchSubmitted(EPOCH_1, 8500, P95_BPS, false, flag);

        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            8500, // Below 9000 threshold
            DIFF_ROOT
        );

        // Verify stored with failure flags
        PriceIntegrity.BatchReport memory report = priceIntegrity.getReport(EPOCH_1);
        assertFalse(report.isPassed);
        assertEq(report.failureFlags, priceIntegrity.FLAG_LOW_SCORE());
    }

    function test_HighP95StoresWithFailureFlag() public {
        // Get flag value first (doesn't affect prank)
        uint8 flag = priceIntegrity.FLAG_HIGH_P95();
        
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit PriceIntegrity.BatchSubmitted(EPOCH_1, SCORE_BPS, 75, false, flag);

        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            75, // Above 50 threshold
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        // Verify stored with failure flags
        PriceIntegrity.BatchReport memory report = priceIntegrity.getReport(EPOCH_1);
        assertFalse(report.isPassed);
        assertEq(report.failureFlags, priceIntegrity.FLAG_HIGH_P95());
    }

    function test_BothFailuresStoresWithCombinedFlags() public {
        // Get flag values first (doesn't affect prank)
        uint8 expectedFlags = priceIntegrity.FLAG_LOW_SCORE() | priceIntegrity.FLAG_HIGH_P95();
        
        vm.prank(reporter);
        vm.expectEmit(true, false, false, true);
        emit PriceIntegrity.BatchSubmitted(EPOCH_1, 8500, 75, false, expectedFlags);

        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            75, // Above 50 threshold
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            8500, // Below 9000 threshold
            DIFF_ROOT
        );

        // Verify stored with both failure flags
        PriceIntegrity.BatchReport memory report = priceIntegrity.getReport(EPOCH_1);
        assertFalse(report.isPassed);
        assertEq(report.failureFlags, expectedFlags);
    }

    // ==================== Edge Case Tests ====================

    function test_ExactThresholdPasses() public {
        vm.prank(reporter);
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            50, // Exactly at threshold
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            9000, // Exactly at threshold
            DIFF_ROOT
        );

        PriceIntegrity.BatchReport memory report = priceIntegrity.getReport(EPOCH_1);
        assertTrue(report.isPassed);
        assertEq(report.failureFlags, 0);
    }

    function test_MaxDirectionMatchBps() public {
        vm.prank(reporter);
        priceIntegrity.submitBatchComparison(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            10000, // Maximum valid value
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        assertEq(priceIntegrity.latestEpochId(), EPOCH_1);
    }

    function test_PassesQualityGate() public view {
        assertTrue(priceIntegrity.passesQualityGate(9000, 50));
        assertTrue(priceIntegrity.passesQualityGate(9500, 25));
        assertFalse(priceIntegrity.passesQualityGate(8999, 50));
        assertFalse(priceIntegrity.passesQualityGate(9000, 51));
    }

    function test_ComputeFailureFlags() public view {
        assertEq(priceIntegrity.computeFailureFlags(9000, 50), 0);
        assertEq(priceIntegrity.computeFailureFlags(8999, 50), priceIntegrity.FLAG_LOW_SCORE());
        assertEq(priceIntegrity.computeFailureFlags(9000, 51), priceIntegrity.FLAG_HIGH_P95());
        assertEq(
            priceIntegrity.computeFailureFlags(8500, 75), 
            priceIntegrity.FLAG_LOW_SCORE() | priceIntegrity.FLAG_HIGH_P95()
        );
    }

    function test_AuditTrailPreservesFailedSubmissions() public {
        // Submit 3 epochs: pass, fail, pass
        vm.startPrank(reporter);
        
        // Epoch 1: Pass
        priceIntegrity.submitBatchComparison(
            1, WINDOW_START, CANDLE_COUNT, INTERNAL_HASH, CHAINLINK_HASH,
            MAE_BPS, 25, MAX_BPS, DIR_MATCH_BPS, OUTLIER_COUNT, 9500, DIFF_ROOT
        );
        
        // Epoch 2: Fail (low score)
        priceIntegrity.submitBatchComparison(
            2, WINDOW_START + 900, CANDLE_COUNT, INTERNAL_HASH, CHAINLINK_HASH,
            MAE_BPS, 25, MAX_BPS, DIR_MATCH_BPS, OUTLIER_COUNT, 8000, DIFF_ROOT
        );
        
        // Epoch 3: Pass
        priceIntegrity.submitBatchComparison(
            3, WINDOW_START + 1800, CANDLE_COUNT, INTERNAL_HASH, CHAINLINK_HASH,
            MAE_BPS, 25, MAX_BPS, DIR_MATCH_BPS, OUTLIER_COUNT, 9200, DIFF_ROOT
        );
        
        vm.stopPrank();

        // Verify all 3 are stored with correct pass/fail status
        assertTrue(priceIntegrity.getReport(1).isPassed);
        assertFalse(priceIntegrity.getReport(2).isPassed);
        assertTrue(priceIntegrity.getReport(3).isPassed);
        
        // Verify monotonic progression maintained
        assertEq(priceIntegrity.latestEpochId(), 3);
    }

    // ==================== IReceiver / onReport Tests ====================

    function test_OnReport_Success() public {
        // Encode report data (same as workflow encoding)
        bytes memory report = abi.encode(
            EPOCH_1,
            WINDOW_START,
            CANDLE_COUNT,
            INTERNAL_HASH,
            CHAINLINK_HASH,
            MAE_BPS,
            P95_BPS,
            MAX_BPS,
            DIR_MATCH_BPS,
            OUTLIER_COUNT,
            SCORE_BPS,
            DIFF_ROOT
        );

        // Call onReport as forwarder
        vm.prank(forwarder);
        priceIntegrity.onReport("", report);

        // Verify report stored
        assertEq(priceIntegrity.latestEpochId(), EPOCH_1);
        
        PriceIntegrity.BatchReport memory stored = priceIntegrity.getReport(EPOCH_1);
        assertEq(stored.epochId, EPOCH_1);
        assertEq(stored.scoreBps, SCORE_BPS);
        assertTrue(stored.isPassed);
    }

    function test_OnReport_RevertInvalidSender() public {
        bytes memory report = abi.encode(
            EPOCH_1, WINDOW_START, CANDLE_COUNT, INTERNAL_HASH, CHAINLINK_HASH,
            MAE_BPS, P95_BPS, MAX_BPS, DIR_MATCH_BPS, OUTLIER_COUNT, SCORE_BPS, DIFF_ROOT
        );

        // Call onReport as non-forwarder should revert
        vm.prank(randomUser);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReceiverTemplate.InvalidSender.selector,
                randomUser,
                forwarder
            )
        );
        priceIntegrity.onReport("", report);
    }

    function test_OnReport_MultipleEpochs() public {
        // Submit epoch 1 via onReport
        vm.startPrank(forwarder);
        
        priceIntegrity.onReport("", abi.encode(
            1, WINDOW_START, CANDLE_COUNT, INTERNAL_HASH, CHAINLINK_HASH,
            MAE_BPS, P95_BPS, MAX_BPS, DIR_MATCH_BPS, OUTLIER_COUNT, SCORE_BPS, DIFF_ROOT
        ));
        
        // Submit epoch 2 via onReport
        priceIntegrity.onReport("", abi.encode(
            2, WINDOW_START + 900, CANDLE_COUNT, INTERNAL_HASH, CHAINLINK_HASH,
            MAE_BPS, P95_BPS, MAX_BPS, DIR_MATCH_BPS, OUTLIER_COUNT, SCORE_BPS, DIFF_ROOT
        ));
        
        vm.stopPrank();

        assertEq(priceIntegrity.latestEpochId(), 2);
    }

    function test_SupportsInterface() public view {
        // IReceiver interface ID
        bytes4 receiverInterface = type(IReceiver).interfaceId;
        assertTrue(priceIntegrity.supportsInterface(receiverInterface));

        // IERC165 interface ID
        bytes4 erc165Interface = type(IERC165).interfaceId;
        assertTrue(priceIntegrity.supportsInterface(erc165Interface));
    }

    function test_ForwarderAddressGetter() public view {
        assertEq(priceIntegrity.getForwarderAddress(), forwarder);
    }

    function test_UpdateForwarderAddress() public {
        address newForwarder = address(101);
        address actualOwner = priceIntegrity.owner();
        
        vm.prank(actualOwner);
        priceIntegrity.updateForwarderAddress(newForwarder);
        
        assertEq(priceIntegrity.getForwarderAddress(), newForwarder);
    }

    function test_UpdateForwarderAddress_RevertNonOwner() public {
        address actualOwner = priceIntegrity.owner();
        
        vm.prank(randomUser);
        vm.expectRevert(
            abi.encodeWithSelector(
                ReceiverTemplate.OnlyOwner.selector,
                randomUser,
                actualOwner
            )
        );
        priceIntegrity.updateForwarderAddress(address(101));
    }
}
