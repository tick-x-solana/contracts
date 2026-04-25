// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {PoolReserveProxy} from "../src/PoolReserveProxy.sol";

/// @title UpgradePoolReserve
/// @notice Deploys a new PoolReserve implementation and upgrades an existing UUPS proxy.
/// @dev Run with the current PoolReserve owner key.
contract UpgradePoolReserve is Script {
    PoolReserve public implementation;
    PoolReserve public poolReserve;
    PoolReserveProxy public proxy;

    address public proxyAddress;

    function setUp() public {
        proxyAddress = vm.envAddress("POOL_RESERVE_PROXY_ADDRESS");
        poolReserve = PoolReserve(proxyAddress);
        proxy = PoolReserveProxy(payable(proxyAddress));

        console.log("Upgrading PoolReserve proxy:", proxyAddress);
        console.log("Current owner:", poolReserve.owner());
        console.log("Current asset:", address(poolReserve.asset()));
        console.log("Current claim signer:", poolReserve.claimSigner());
        console.log("Current implementation:", proxy.implementation());
    }

    function run() public {
        vm.startBroadcast();

        implementation = new PoolReserve();
        poolReserve.upgradeToAndCall(address(implementation), "");

        vm.stopBroadcast();

        console.log("New PoolReserve implementation deployed at:", address(implementation));
        console.log("Proxy implementation after upgrade:", proxy.implementation());
    }
}
