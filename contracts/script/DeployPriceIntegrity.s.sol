// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PriceIntegrity} from "../src/PriceIntegrity.sol";

/// @title DeployPriceIntegrity
/// @notice Deploys only the PriceIntegrity contract.
contract DeployPriceIntegrity is Script {
    PriceIntegrity public priceIntegrity;

    address public forwarder;

    function setUp() public {

        try vm.envAddress("FORWARDER_ADDRESS") returns (address configuredForwarder) {
            forwarder = configuredForwarder;
        } catch {
            forwarder = address(0x1);
        }

        console.log("Deploying PriceIntegrity");
        console.log("Forwarder:", forwarder);
    }

    function run() public {
        vm.startBroadcast();

        priceIntegrity = new PriceIntegrity(address(0xc04750A906bf931e458c042A85A3D828b8A519B0), forwarder);
        console.log("PriceIntegrity deployed at:", address(priceIntegrity));

        vm.stopBroadcast();
    }
}
