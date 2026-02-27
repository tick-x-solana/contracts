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

/// @title DeployHackathon
/// @notice Deployment script for Tap.fun x Chainlink hackathon PoC
/// @dev Run with: forge script script/DeployHackathon.s.sol --rpc-url <RPC_URL> --broadcast
contract DeployHackathon is Script {
    // Deployed contract instances
    Roles public roles;
    PriceIntegrity public priceIntegrity;
    PoolReserve public poolReserve;
    Settlement public settlement;
    LPDistributor public lpDistributor;
    StrategyManager public strategyManager;

    // Role addresses (configure via environment or constructor)
    address public owner;
    address public reporter;
    address public settler;
    address public strategist;
    address public distributor;

    // Asset address (USDT or mock)
    address public asset;

    // Chainlink KeystoneForwarder address (set via environment)
    // For Sepolia: Get from Chainlink documentation or team
    address public forwarder;

    function setUp() public {
        // Load addresses from environment
        owner = vm.envAddress("OWNER_ADDRESS");
        reporter = vm.envAddress("REPORTER_ADDRESS");
        settler = vm.envAddress("SETTLER_ADDRESS");
        strategist = vm.envAddress("STRATEGIST_ADDRESS");
        distributor = vm.envAddress("DISTRIBUTOR_ADDRESS");
        asset = vm.envAddress("ASSET_ADDRESS");
        
        // Forwarder is optional - if not set, use a placeholder
        // In production, this must be the real Chainlink KeystoneForwarder
        try vm.envAddress("FORWARDER_ADDRESS") returns (address f) {
            forwarder = f;
        } catch {
            // Default placeholder for testing (must be updated for production)
            forwarder = address(0x1);
        }

        console.log("Deploying with owner:", owner);
        console.log("Reporter:", reporter);
        console.log("Settler:", settler);
        console.log("Strategist:", strategist);
        console.log("Distributor:", distributor);
        console.log("Asset:", asset);
        console.log("Forwarder:", forwarder);
    }

    function run() public {
        vm.startBroadcast();

        // Step 1: Deploy Roles contract
        roles = new Roles(owner, reporter, settler, strategist, distributor);
        console.log("Roles deployed at:", address(roles));

        // Step 2: Deploy PriceIntegrity
        priceIntegrity = new PriceIntegrity(address(roles), forwarder);
        console.log("PriceIntegrity deployed at:", address(priceIntegrity));

        // Step 3: Deploy PoolReserve
        poolReserve = new PoolReserve(address(roles), asset, forwarder);
        console.log("PoolReserve deployed at:", address(poolReserve));

        // Step 4: Deploy Settlement
        settlement = new Settlement(address(roles), address(poolReserve), forwarder);
        console.log("Settlement deployed at:", address(settlement));

        // Step 5: Deploy LPDistributor
        lpDistributor = new LPDistributor(address(roles), address(poolReserve), forwarder);
        console.log("LPDistributor deployed at:", address(lpDistributor));

        // Step 6: Deploy StrategyManager
        strategyManager = new StrategyManager(address(roles), forwarder);
        console.log("StrategyManager deployed at:", address(strategyManager));

        // Step 7: Update Roles to set contract addresses as authorized callers
        // Settlement needs to be settler to call PoolReserve.setWithdrawable
        roles.setSettler(address(settlement));
        console.log("Settlement set as settler in Roles");

        // LPDistributor needs to be distributor to call PoolReserve.allocateReserveToLPDistributor
        roles.setDistributor(address(lpDistributor));
        console.log("LPDistributor set as distributor in Roles");

        vm.stopBroadcast();

        // Summary
        console.log("\n=== Deployment Summary ===");
        console.log("Roles:", address(roles));
        console.log("PriceIntegrity:", address(priceIntegrity));
        console.log("PoolReserve:", address(poolReserve));
        console.log("Settlement:", address(settlement));
        console.log("LPDistributor:", address(lpDistributor));
        console.log("StrategyManager:", address(strategyManager));
    }
}
