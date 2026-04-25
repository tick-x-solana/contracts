// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {PoolReserveProxy} from "../src/PoolReserveProxy.sol";

/// @title DeployPoolReserve
/// @notice Deploys only the PoolReserve contract using existing dependency addresses
/// @dev Run with: forge script script/DeployPoolReserve.s.sol --rpc-url <RPC_URL> --broadcast
contract DeployPoolReserve is Script {
    PoolReserve public poolReserve;
    PoolReserve public implementation;
    PoolReserveProxy public proxy;

    address public owner;
    address public asset;
    address public claimSigner;

    function setUp() public {
        owner = vm.envAddress("OWNER_ADDRESS");
        asset = vm.envAddress("ASSET_ADDRESS");

        try vm.envAddress("CLAIM_SIGNER_ADDRESS") returns (address configuredSigner) {
            claimSigner = configuredSigner;
        } catch {
            claimSigner = owner;
        }

        console.log("Deploying upgradeable PoolReserve");
        console.log("Owner:", owner);
        console.log("Asset:", asset);
        console.log("Claim signer:", claimSigner);
    }

    function run() public {
        vm.startBroadcast();

        implementation = new PoolReserve();
        proxy = new PoolReserveProxy(
            address(implementation),
            abi.encodeCall(PoolReserve.initialize, (owner, asset, claimSigner))
        );
        poolReserve = PoolReserve(address(proxy));

        console.log("PoolReserve implementation deployed at:", address(implementation));
        console.log("PoolReserve proxy deployed at:", address(poolReserve));

        vm.stopBroadcast();
    }
}
