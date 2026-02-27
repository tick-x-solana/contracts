// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Settlement} from "../src/Settlement.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {Roles} from "../src/Roles.sol";
import {MockERC20} from "./PoolReserve.t.sol";
import {SettlementBatchCommitted, PaidMarked, WithdrawableSet, TraderClaimed} from "../src/Events.sol";

contract SettlementPoolReserveIntegrationTest is Test {
    Settlement public settlement;
    PoolReserve public poolReserve;
    Roles public roles;
    MockERC20 public asset;
    
    address public owner = address(1);
    address public reporter = address(2);
    address public settler = address(3);
    address public distributor = address(4);
    
    address public lp1 = address(10);
    address public trader1 = address(20);

    bytes32 constant BATCH_ID = keccak256("integration_batch");
    uint256 constant INITIAL_LP_DEPOSIT = 10_000e18;
    uint256 constant TRADER_DEPOSIT = 5000e18;
    uint256 constant WINNING_PAYOUT = 1000e18;

    function setUp() public {
        // Deploy mock asset
        asset = new MockERC20();
        
        // Deploy roles with owner as placeholder settler
        vm.prank(owner);
        roles = new Roles(owner, reporter, owner, address(0), distributor);
        
        // Deploy PoolReserve
        poolReserve = new PoolReserve(address(roles), address(asset), address(0x999));
        
        // Deploy Settlement
        settlement = new Settlement(address(roles), address(poolReserve), address(0x999));
        
        // Set Settlement contract as the settler in Roles so it can call PoolReserve
        vm.prank(owner);
        roles.setSettler(address(settlement));
        
        // Mint tokens
        asset.mint(lp1, 100_000e18);
        asset.mint(trader1, 100_000e18);
    }

    // ==================== Full Flow Integration Test ====================

    function test_FullSettlementFlow() public {
        // Step 1: LP provides liquidity
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), INITIAL_LP_DEPOSIT);
        poolReserve.depositLP(INITIAL_LP_DEPOSIT);
        vm.stopPrank();

        assertEq(poolReserve.totalCollateral(), INITIAL_LP_DEPOSIT);
        assertEq(poolReserve.totalLPShares(), INITIAL_LP_DEPOSIT);

        // Step 2: Trader deposits collateral
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), TRADER_DEPOSIT);
        poolReserve.depositTrader(TRADER_DEPOSIT);
        vm.stopPrank();

        assertEq(poolReserve.traderBalanceOf(trader1), TRADER_DEPOSIT);
        assertEq(poolReserve.totalTraderBalance(), TRADER_DEPOSIT);
        assertEq(poolReserve.totalCollateral(), INITIAL_LP_DEPOSIT + TRADER_DEPOSIT);

        // Step 3: Trader places a bet (off-chain), then wins
        // Step 4: Settlement batch is committed
        uint256 withdrawableCap = TRADER_DEPOSIT + WINNING_PAYOUT;
        
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID,
            keccak256("merkle_root"),
            WINNING_PAYOUT,
            withdrawableCap,
            block.timestamp,
            block.timestamp + 300
        );

        Settlement.Batch memory batch = settlement.getBatch(BATCH_ID);
        assertTrue(batch.exists);
        assertEq(batch.totalPayout, WINNING_PAYOUT);
        assertEq(batch.withdrawableCap, withdrawableCap);

        // Step 5: Set withdrawable for winning trader
        vm.prank(owner);
        settlement.setWithdrawableViaPoolReserve(trader1, withdrawableCap);

        assertEq(poolReserve.traderWithdrawableOf(trader1), withdrawableCap);

        // Step 6: Mark payout in settlement contract
        vm.prank(owner);
        settlement.markPaid(trader1, WINNING_PAYOUT, BATCH_ID);

        assertEq(settlement.getPaidAmount(BATCH_ID, trader1), WINNING_PAYOUT);

        // Step 7: Trader claims winnings
        uint256 balanceBefore = asset.balanceOf(trader1);
        
        vm.prank(trader1);
        poolReserve.claimTrader(WINNING_PAYOUT);

        uint256 balanceAfter = asset.balanceOf(trader1);
        assertEq(balanceAfter, balanceBefore + WINNING_PAYOUT);
        assertEq(poolReserve.traderWithdrawableOf(trader1), withdrawableCap - WINNING_PAYOUT);
        assertEq(poolReserve.traderBalanceOf(trader1), TRADER_DEPOSIT - WINNING_PAYOUT); // Balance reduced by claim

        // Step 8: Report solvency after settlement
        uint256 finalCollateral = poolReserve.totalCollateral();
        vm.prank(reporter);
        poolReserve.reportSolvency(
            1,
            finalCollateral,
            0, // No outstanding liability
            0,
            0
        );

        PoolReserve.SolvencyReport memory solvencyReport = poolReserve.getLatestSolvencyReport();
        assertEq(solvencyReport.epochId, 1);
        assertEq(solvencyReport.solvencyRatio, type(uint256).max); // Infinite with no liability
    }

    // ==================== Multi-Trader Settlement Flow ====================

    function test_MultiTraderSettlementFlow() public {
        address trader2 = address(21);
        address trader3 = address(22);
        asset.mint(trader2, 10_000e18);
        asset.mint(trader3, 10_000e18);

        // LP provides liquidity
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 50_000e18);
        poolReserve.depositLP(50_000e18);
        vm.stopPrank();

        // Multiple traders deposit
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositTrader(1000e18);
        vm.stopPrank();

        vm.startPrank(trader2);
        asset.approve(address(poolReserve), 2000e18);
        poolReserve.depositTrader(2000e18);
        vm.stopPrank();

        vm.startPrank(trader3);
        asset.approve(address(poolReserve), 3000e18);
        poolReserve.depositTrader(3000e18);
        vm.stopPrank();

        assertEq(poolReserve.totalTraderBalance(), 6000e18);

        // Batch commit settlement
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID,
            keccak256("multi_trader_merkle"),
            1500e18, // Total payout
            1500e18,
            block.timestamp,
            block.timestamp + 300
        );

        // Batch set withdrawable for multiple traders
        address[] memory accounts = new address[](3);
        accounts[0] = trader1;
        accounts[1] = trader2;
        accounts[2] = trader3;
        
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1500e18; // trader1 gets 500e18 winnings + 1000e18 deposit
        amounts[1] = 2000e18; // trader2 breaks even
        amounts[2] = 3000e18; // trader3 breaks even

        vm.prank(owner);
        settlement.batchSetWithdrawable(accounts, amounts);

        assertEq(poolReserve.traderWithdrawableOf(trader1), 1500e18);
        assertEq(poolReserve.traderWithdrawableOf(trader2), 2000e18);
        assertEq(poolReserve.traderWithdrawableOf(trader3), 3000e18);

        // Traders claim their funds
        vm.prank(trader1);
        poolReserve.claimTrader(500e18); // Claim just the winnings

        assertEq(poolReserve.traderWithdrawableOf(trader1), 1000e18);
        assertEq(poolReserve.traderBalanceOf(trader1), 500e18); // 1000 deposit - 500 claimed
    }

    // ==================== Settlement with Solvency Check ====================

    function test_SettlementWithSolvencyReporting() public {
        // Setup pool with LP and trader
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 20_000e18);
        poolReserve.depositLP(20_000e18);
        vm.stopPrank();

        vm.startPrank(trader1);
        asset.approve(address(poolReserve), 5000e18);
        poolReserve.depositTrader(5000e18);
        vm.stopPrank();

        uint256 initialCollateral = poolReserve.totalCollateral();
        assertEq(initialCollateral, 25_000e18);

        // Large payout settlement
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID,
            keccak256("large_payout"),
            3000e18,
            8000e18,
            block.timestamp,
            block.timestamp + 300
        );

        // Update withdrawable
        vm.prank(owner);
        settlement.setWithdrawableViaPoolReserve(trader1, 8000e18);

        // Report solvency before payout
        vm.prank(reporter);
        poolReserve.reportSolvency(
            1,
            initialCollateral,
            3000e18, // Outstanding liability
            1200, // 12% utilization
            3000e18
        );

        PoolReserve.SolvencyReport memory report = poolReserve.getLatestSolvencyReport();
        assertEq(report.poolBalance, initialCollateral);
        assertEq(report.totalLiability, 3000e18);
        // solvencyRatio = poolBalance * 1e18 / totalLiability = 25_000e18 * 1e18 / 3000e18
        uint256 expectedRatio = (initialCollateral * 1e18) / 3000e18;
        assertEq(report.solvencyRatio, expectedRatio); // ~8.33x

        // Trader claims payout
        vm.prank(trader1);
        poolReserve.claimTrader(3000e18);

        // Report solvency after payout (no liability)
        uint256 collateralAfter = poolReserve.totalCollateral();
        vm.prank(reporter);
        poolReserve.reportSolvency(
            2,
            collateralAfter,
            0,
            0,
            0
        );

        PoolReserve.SolvencyReport memory reportAfter = poolReserve.getLatestSolvencyReport();
        assertEq(reportAfter.solvencyRatio, type(uint256).max);
    }

    // ==================== Sequential Settlements ====================

    function test_SequentialSettlements() public {
        // Setup
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        vm.startPrank(trader1);
        asset.approve(address(poolReserve), 10_000e18);
        poolReserve.depositTrader(10_000e18);
        vm.stopPrank();

        // First settlement - trader wins
        bytes32 batch1 = keccak256("batch_1");
        vm.prank(owner);
        settlement.commitSettlementBatch(
            batch1,
            keccak256("merkle_1"),
            2000e18,
            12_000e18,
            block.timestamp,
            block.timestamp + 300
        );

        vm.prank(owner);
        settlement.setWithdrawableViaPoolReserve(trader1, 12_000e18);

        vm.prank(trader1);
        poolReserve.claimTrader(2000e18);

        assertEq(poolReserve.traderWithdrawableOf(trader1), 10_000e18);
        assertEq(poolReserve.traderBalanceOf(trader1), 8000e18); // 10k - 2k claimed

        // Second settlement - trader wins again
        bytes32 batch2 = keccak256("batch_2");
        vm.prank(owner);
        settlement.commitSettlementBatch(
            batch2,
            keccak256("merkle_2"),
            3000e18,
            13_000e18, // Increased cap
            block.timestamp + 300,
            block.timestamp + 600
        );

        vm.prank(owner);
        settlement.setWithdrawableViaPoolReserve(trader1, 13_000e18);

        vm.prank(trader1);
        poolReserve.claimTrader(3000e18);

        assertEq(poolReserve.traderWithdrawableOf(trader1), 10_000e18);
        assertEq(poolReserve.traderBalanceOf(trader1), 5000e18); // 10k - 2k - 3k claimed

        // Verify both batches exist
        assertTrue(settlement.getBatch(batch1).exists);
        assertTrue(settlement.getBatch(batch2).exists);
        assertEq(settlement.batchCount(), 2);
    }
}
