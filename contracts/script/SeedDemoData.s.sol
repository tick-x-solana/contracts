// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Roles} from "../src/Roles.sol";
import {PriceIntegrity} from "../src/PriceIntegrity.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {Settlement} from "../src/Settlement.sol";
import {LPDistributor} from "../src/LPDistributor.sol";
import {StrategyManager} from "../src/StrategyManager.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title SeedDemoData
/// @notice Seeds demo data for hackathon PoC demonstration
/// @dev Run after DeployHackathon.s.sol: forge script script/SeedDemoData.s.sol --rpc-url <RPC_URL> --broadcast
contract SeedDemoData is Script {
    // Contract addresses (load from environment)
    PriceIntegrity public priceIntegrity;
    PoolReserve public poolReserve;
    Settlement public settlement;
    LPDistributor public lpDistributor;
    StrategyManager public strategyManager;
    IERC20 public asset;

    // Role addresses
    address public owner;
    address public reporter;
    address public lp1;
    address public trader1;

    function setUp() public {
        owner = vm.envAddress("OWNER_ADDRESS");
        reporter = vm.envAddress("REPORTER_ADDRESS");
        lp1 = vm.envAddress("LP1_ADDRESS");
        trader1 = vm.envAddress("TRADER1_ADDRESS");

        priceIntegrity = PriceIntegrity(vm.envAddress("PRICE_INTEGRITY_ADDRESS"));
        poolReserve = PoolReserve(vm.envAddress("POOL_RESERVE_ADDRESS"));
        settlement = Settlement(vm.envAddress("SETTLEMENT_ADDRESS"));
        lpDistributor = LPDistributor(vm.envAddress("LP_DISTRIBUTOR_ADDRESS"));
        strategyManager = StrategyManager(vm.envAddress("STRATEGY_MANAGER_ADDRESS"));
        asset = IERC20(vm.envAddress("ASSET_ADDRESS"));

        console.log("Seeding data...");
    }

    function run() public {
        vm.startBroadcast();

        // ========== 1. LP Deposit ==========
        uint256 lpDeposit = 100_000e18;
        asset.approve(address(poolReserve), lpDeposit);
        poolReserve.depositLP(lpDeposit);
        console.log("LP deposited:", lpDeposit);

        // ========== 2. Trader Deposit ==========
        uint256 traderDeposit = 10_000e18;
        asset.approve(address(poolReserve), traderDeposit);
        poolReserve.depositTrader(traderDeposit);
        console.log("Trader deposited:", traderDeposit);

        // ========== 3. Price Integrity Batch Report ==========
        // Submit a passing batch
        bytes32 internalHash = keccak256("internal_candles_batch_1");
        bytes32 chainlinkHash = keccak256("chainlink_candles_batch_1");
        bytes32 diffMerkleRoot = keccak256("diff_merkle_root_1");
        
        // Use reporter key for this call
        vm.stopBroadcast();
        vm.startBroadcast(vm.envUint("REPORTER_PRIVATE_KEY"));
        
        priceIntegrity.submitBatchComparison(
            1, // epochId
            block.timestamp - 900, // windowStart (15 min ago)
            900, // candleCount (15 min of 1s candles)
            internalHash,
            chainlinkHash,
            5, // ohlcMaeBps (0.05%)
            25, // ohlcP95Bps (0.25%)
            40, // ohlcMaxBps (0.40%)
            9800, // directionMatchBps (98%)
            5, // outlierCount
            9500, // scoreBps (95% - above 90% threshold)
            diffMerkleRoot
        );
        console.log("Price integrity batch 1 submitted (passed)");

        // Submit a failing batch (low score)
        priceIntegrity.submitBatchComparison(
            2,
            block.timestamp - 900,
            900,
            keccak256("internal_candles_batch_2"),
            keccak256("chainlink_candles_batch_2"),
            15, // ohlcMaeBps (0.15%)
            75, // ohlcP95Bps (0.75% - above threshold)
            120, // ohlcMaxBps (1.20%)
            9200, // directionMatchBps (92%)
            45, // outlierCount
            8500, // scoreBps (85% - below 90% threshold, but stored with flags)
            keccak256("diff_merkle_root_2")
        );
        console.log("Price integrity batch 2 submitted (failed with flags)");

        vm.stopBroadcast();
        vm.startBroadcast();

        // ========== 4. Solvency Report ==========
        vm.stopBroadcast();
        vm.startBroadcast(vm.envUint("REPORTER_PRIVATE_KEY"));
        
        poolReserve.reportSolvency(
            1, // epochId
            poolReserve.totalCollateral(), // poolBalance
            5000e18, // totalLiability (example)
            500, // utilizationBps (5%)
            1000e18 // maxSingleBetExposure
        );
        console.log("Solvency report 1 submitted");

        vm.stopBroadcast();
        vm.startBroadcast();

        // ========== 5. Settlement Batch Commit ==========
        bytes32 batchId = keccak256("demo_batch_1");
        bytes32 merkleRoot = keccak256("settlement_merkle_root_1");
        uint256 totalPayout = 2000e18;
        uint256 withdrawableCap = 12_000e18;
        
        settlement.commitSettlementBatch(
            batchId,
            merkleRoot,
            totalPayout,
            withdrawableCap,
            block.timestamp - 300,
            block.timestamp
        );
        console.log("Settlement batch committed");

        // Note: withdrawable setting skipped for demo (traders can claim directly)

        // Mark payout
        settlement.markPaid(trader1, totalPayout, batchId);
        console.log("Payout marked");

        // ========== 6. Strategy Regime Update ==========
        vm.stopBroadcast();
        vm.startBroadcast(vm.envUint("STRATEGIST_PRIVATE_KEY"));
        
        strategyManager.setVolatilityRegime(
            1, // regimeId
            150, // fortressSpreadBps (1.5%)
            100 // maxMultiplier (100x)
        );
        console.log("Volatility regime 1 set");

        vm.stopBroadcast();
        vm.startBroadcast();

        // ========== 7. LP Distribution Request ==========
        vm.stopBroadcast();
        vm.startBroadcast(vm.envUint("OWNER_PRIVATE_KEY"));
        
        lpDistributor.queueDistribution(
            1, // epochId
            5000e18, // amount
            16015286601757825753, // Ethereum Sepolia chain selector
            address(0x1234) // example receiver
        );
        console.log("LP distribution requested");

        vm.stopBroadcast();

        // ========== Summary ==========
        console.log("\n=== Demo Data Seeded ===");
        console.log("LP Shares:", poolReserve.totalLPShares());
        console.log("Total Collateral:", poolReserve.totalCollateral());
        console.log("Price Integrity Latest Epoch:", priceIntegrity.latestEpochId());
        console.log("Settlement Batch Count:", settlement.batchCount());
        console.log("Current Strategy Regime:", strategyManager.latestRegimeId());
        console.log("LP Distribution Count:", lpDistributor.requestCount());
    }
}
