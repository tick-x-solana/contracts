// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {
    InvalidAmount,
    InsufficientShares,
    InsufficientCollateral,
    NativeTransferFailed
} from "./Errors.sol";
import {LPDeposited, LPWithdrawn, TraderDeposited, TraderClaimed} from "./Events.sol";

/// @title PoolReserveNative
/// @notice Native-asset vault with LP share accounting and separate trader balances
/// @dev Uses the chain native coin as collateral with no external role or report dependencies
contract PoolReserveNative {
    /// @notice Total LP shares outstanding
    uint256 public totalLPShares;

    /// @notice LP shares per address
    mapping(address => uint256) public lpSharesOf;

    receive() external payable {
        revert InvalidAmount();
    }

    // ==================== LP Functions ====================

    /// @notice Deposit native assets and mint LP shares
    function depositLP() external payable {
        uint256 amount = msg.value;
        if (amount == 0) revert InvalidAmount();

        uint256 shares;
        uint256 totalAssetsBefore = address(this).balance - amount;

        if (totalLPShares == 0) {
            shares = amount;
        } else {
            shares = (amount * totalLPShares) / totalAssetsBefore;
        }

        if (shares == 0) revert InvalidAmount();

        totalLPShares += shares;
        lpSharesOf[msg.sender] += shares;

        emit LPDeposited(msg.sender, amount, shares);
    }

    /// @notice Burn LP shares and withdraw native assets
    /// @param shares Amount of shares to burn
    function withdrawLP(uint256 shares) external {
        if (shares == 0) revert InvalidAmount();
        if (lpSharesOf[msg.sender] < shares) revert InsufficientShares();

        uint256 totalAssets = address(this).balance;
        uint256 amount = (shares * totalAssets) / totalLPShares;

        totalLPShares -= shares;
        lpSharesOf[msg.sender] -= shares;

        _sendNative(payable(msg.sender), amount);

        emit LPWithdrawn(msg.sender, shares, amount);
    }

    // ==================== Trader Functions ====================

    /// @notice Deposit trader collateral
    function depositTrader() external payable {
        uint256 amount = msg.value;
        if (amount == 0) revert InvalidAmount();

        emit TraderDeposited(msg.sender, amount);
    }

    /// @notice Claim trader amount
    /// @param amount Amount to claim
    function claimTrader(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (address(this).balance < amount) revert InsufficientCollateral();

        _sendNative(payable(msg.sender), amount);

        emit TraderClaimed(msg.sender, amount);
    }

    // ==================== View Functions ====================

    /// @notice Get total collateral in the vault
    function totalCollateral() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Get LP value for an address
    function lpValueOf(address lp) external view returns (uint256) {
        if (totalLPShares == 0) return 0;
        return (lpSharesOf[lp] * address(this).balance) / totalLPShares;
    }

    /// @notice Preview shares for a given deposit amount
    function previewDepositLP(uint256 amount) external view returns (uint256 shares) {
        if (amount == 0) return 0;
        uint256 totalAssetsBefore = address(this).balance;

        if (totalLPShares == 0) {
            shares = amount;
        } else {
            shares = (amount * totalLPShares) / totalAssetsBefore;
        }
    }

    /// @notice Preview assets for a given share amount
    function previewWithdrawLP(uint256 shares) external view returns (uint256 amount) {
        if (shares == 0 || totalLPShares == 0) return 0;
        amount = (shares * address(this).balance) / totalLPShares;
    }

    function _sendNative(address payable to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }
}
