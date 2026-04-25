// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title PoolReserveProxy
/// @notice ERC1967 proxy used with PoolReserve's UUPS implementation.
contract PoolReserveProxy is ERC1967Proxy {
    constructor(address implementation_, bytes memory initData) ERC1967Proxy(implementation_, initData) {}

    function implementation() external view returns (address) {
        return _implementation();
    }
}
