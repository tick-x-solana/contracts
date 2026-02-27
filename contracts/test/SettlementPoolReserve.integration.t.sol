// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Settlement} from "../src/Settlement.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {Roles} from "../src/Roles.sol";
import {MockERC20} from "./PoolReserve.t.sol";
import {SettlementBatchCommitted, PaidMarked, TraderClaimed} from "../src/Events.sol";

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

    // ==================== Full Flow Integration Test (Demo: no balance tracking) ====================

    function test_FullSettlementFlow() public {
        // Step 1: LP provides liquidity
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), INITIAL_LP_DEPOSIT);
        poolReserve.depositLP(INITIAL_LP_DEPOSIT);
        vm.stopPrank();

        assertEq(poolReserve.totalCollateral(), INITIAL_LP_DEPOSIT);
        assertEq(poolReserve.totalLPShares(), INITIAL_LP_DEPOSIT);

        // Step 2: Trader deposits collateral (demo: no balance tracking, just transfers)
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), TRADER_DEPOSIT);
        poolReserve.depositTrader(TRADER_DEPOSIT);
        vm.stopPrank();

        // Total collateral includes trader deposit
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

        // Step 5: Mark payout in settlement contract (no withdrawable setting needed for demo)
        vm.prank(owner);
        settlement.markPaid(trader1, WINNING_PAYOUT, BATCH_ID);

        assertEq(settlement.getPaidAmount(BATCH_ID, trader1), WINNING_PAYOUT);

        // Step 6: Trader claims winnings directly (demo: no withdrawable check)
        uint256 balanceBefore = asset.balanceOf(trader1);
        
        vm.prank(trader1);
        poolReserve.claimTrader(WINNING_PAYOUT);

        uint256 balanceAfter = asset.balanceOf(trader1);
        assertEq(balanceAfter, balanceBefore + WINNING_PAYOUT);
        // Pool collateral reduced by payout
        assertEq(poolReserve.totalCollateral(), INITIAL_LP_DEPOSIT + TRADER_DEPOSIT - WINNING_PAYOUT);

        // Step 7: Report solvency after settlement
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

    // ==================== Multi-Trader Settlement Flow (Demo: no balance tracking) ====================

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

        // Multiple traders deposit (demo: no balance tracking)
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

        // Total collateral includes all deposits
        assertEq(poolReserve.totalCollateral(), 56_000e18); // 50k + 6k

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

        // Traders claim their funds directly (demo: no withdrawable check)
        uint256 trader1BalanceBefore = asset.balanceOf(trader1);
        vm.prank(trader1);
        poolReserve.claimTrader(500e18); // Claim just some amount

        // Trader received tokens
        assertEq(asset.balanceOf(trader1), trader1BalanceBefore + 500e18);
        // Pool collateral reduced
        assertEq(poolReserve.totalCollateral(), 55_500e18);
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

        // Trader claims payout directly (demo: no withdrawable check)
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

    // ==================== Sequential Settlements (Demo: no balance tracking) ====================

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

        uint256 initialCollateral = poolReserve.totalCollateral();

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

        // Trader claims directly (demo: no withdrawable check)
        vm.prank(trader1);
        poolReserve.claimTrader(2000e18);

        // Pool collateral reduced
        assertEq(poolReserve.totalCollateral(), initialCollateral - 2000e18);

        // Second settlement - trader wins again
        bytes32 batch2 = keccak256("batch_2");
        vm.prank(owner);
        settlement.commitSettlementBatch(
            batch2,
            keccak256("merkle_2"),
            3000e18,
            13_000e18,
            block.timestamp + 300,
            block.timestamp + 600
        );

        vm.prank(trader1);
        poolReserve.claimTrader(3000e18);

        // Pool collateral further reduced
        assertEq(poolReserve.totalCollateral(), initialCollateral - 2000e18 - 3000e18);

        // Verify both batches exist
        assertTrue(settlement.getBatch(batch1).exists);
        assertTrue(settlement.getBatch(batch2).exists);
        assertEq(settlement.batchCount(), 2);
    }
}
