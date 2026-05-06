// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Minimal Permit2 SignatureTransfer interface used by PoolReserve.
interface IAllowanceTransfer {
    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;
}
