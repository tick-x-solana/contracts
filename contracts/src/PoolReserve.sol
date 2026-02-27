// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {Roles} from "./Roles.sol";
import {ReceiverTemplate} from "./abstracts/ReceiverTemplate.sol";
import {
    Unauthorized,
    InvalidAmount,
    ZeroAddress,
    InsufficientShares,
    SolvencyRatioTooLow
} from "./Errors.sol";
import {
    LPDeposited,
    LPWithdrawn,
    TraderDeposited,
    TraderClaimed,
    SolvencyReported,
    ReserveAllocatedToDistributor
} from "./Events.sol";

/// @title PoolReserve
/// @notice App currency vault with LP share accounting and separate trader balances
/// @dev Handles LP deposits/withdrawals, trader collateral, and solvency reporting
contract PoolReserve is ReceiverTemplate {
    /// @notice Minimum solvency ratio (1.5x = 1.5e18)
    uint256 public constant MIN_SOLVENCY_RATIO = 1.5e18;

    /// @notice Precision for ratio calculations (1e18 = 1.0)
    uint256 public constant RATIO_PRECISION = 1e18;

    /// @notice Reference to the roles contract for access control
    Roles public immutable roles;

    /// @notice The ERC20 token used as the vault asset (e.g., USDT)
    IERC20 public immutable asset;

    /// @notice Total LP shares outstanding
    uint256 public totalLPShares;

    /// @notice LP shares per address
    mapping(address => uint256) public lpSharesOf;

    /// @notice Latest solvency epoch ID
    uint256 public latestSolvencyEpochId;

    /// @notice Solvency report data structure
    struct SolvencyReport {
        uint256 epochId;
        uint256 poolBalance;
        uint256 totalLiability;
        uint256 utilizationBps;
        uint256 maxSingleBetExposure;
        uint256 timestamp;
        uint256 solvencyRatio;
    }

    /// @notice Stored solvency reports by epoch ID
    mapping(uint256 => SolvencyReport) public solvencyReports;

    modifier onlyOwner() override {
        if (msg.sender != roles.owner()) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyReporter() {
        if (msg.sender != roles.reporter()) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyDistributor() {
        if (msg.sender != roles.distributor()) revert Unauthorized(msg.sender);
        _;
    }

    /// @param _roles Address of the Roles contract
    /// @param _asset Address of the ERC20 asset (e.g., USDT)
    /// @param _forwarder Address of the forwarder contract
    constructor(address _roles, address _asset, address _forwarder) ReceiverTemplate(_forwarder) {
        if (_roles == address(0)) revert ZeroAddress();
        if (_asset == address(0)) revert ZeroAddress();
        roles = Roles(_roles);
        asset = IERC20(_asset);
    }

    // ==================== LP Functions ====================

    /// @notice Deposit assets and mint LP shares
    /// @param amount Amount of assets to deposit
    function depositLP(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        uint256 shares;
        // Query balance BEFORE the transfer (assets already in pool)
        uint256 totalAssetsBefore = asset.balanceOf(address(this));

        if (totalLPShares == 0) {
            // First LP: 1:1 ratio
            shares = amount;
        } else {
            // Subsequent LPs: shares proportional to contribution
            // amount / (totalAssetsBefore + amount) = shares / (totalLPShares + shares)
            // shares = amount * totalLPShares / totalAssetsBefore
            shares = (amount * totalLPShares) / totalAssetsBefore;
        }

        if (shares == 0) revert InvalidAmount();

        // Update state
        totalLPShares += shares;
        lpSharesOf[msg.sender] += shares;

        // Transfer assets from LP
        bool success = asset.transferFrom(msg.sender, address(this), amount);
        if (!success) revert InvalidAmount();

        emit LPDeposited(msg.sender, amount, shares);
    }

    /// @notice Burn LP shares and withdraw assets
    /// @param shares Amount of shares to burn
    function withdrawLP(uint256 shares) external {
        if (shares == 0) revert InvalidAmount();
        if (lpSharesOf[msg.sender] < shares) revert InsufficientShares();

        uint256 totalAssets = asset.balanceOf(address(this));
        uint256 amount = (shares * totalAssets) / totalLPShares;

        // Update state
        totalLPShares -= shares;
        lpSharesOf[msg.sender] -= shares;

        // Transfer assets to LP
        bool success = asset.transfer(msg.sender, amount);
        if (!success) revert InvalidAmount();

        emit LPWithdrawn(msg.sender, shares, amount);
    }

    // ==================== Trader Functions ====================

    /// @notice Deposit trader collateral (demo: no balance tracking)
    /// @param amount Amount of assets to deposit
    function depositTrader(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        // Transfer assets from trader (no state tracking for demo)
        bool success = asset.transferFrom(msg.sender, address(this), amount);
        if (!success) revert InvalidAmount();

        emit TraderDeposited(msg.sender, amount);
    }

    /// @notice Claim trader amount (demo: no withdrawable check)
    /// @param amount Amount to claim
    function claimTrader(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        // Transfer assets to trader (no balance check for demo)
        bool success = asset.transfer(msg.sender, amount);
        if (!success) revert InvalidAmount();

        emit TraderClaimed(msg.sender, amount);
    }

    // ==================== Solvency Reporting ====================

    /// @notice Process report from receiver template (called by forwarder)
    /// @param report Encoded solvency report data
    function _processReport(bytes calldata report) internal override {
        (
            uint256 epochId,
            uint256 poolBalance,
            uint256 totalLiability,
            uint256 utilizationBps,
            uint256 maxSingleBetExposure
        ) = abi.decode(report, (uint256, uint256, uint256, uint256, uint256));

        _reportSolvency(epochId, poolBalance, totalLiability, utilizationBps, maxSingleBetExposure);
    }

    /// @notice Internal function to process solvency report
    /// @param epochId Unique epoch identifier (must be monotonically increasing)
    /// @param poolBalance Total pool balance at time of report
    /// @param totalLiability Total outstanding liability
    /// @param utilizationBps Utilization ratio in basis points
    /// @param maxSingleBetExposure Maximum exposure from a single bet
    function _reportSolvency(
        uint256 epochId,
        uint256 poolBalance,
        uint256 totalLiability,
        uint256 utilizationBps,
        uint256 maxSingleBetExposure
    ) internal {
        // Validate epoch monotonicity
        if (epochId <= latestSolvencyEpochId) {
            revert InvalidAmount(); // Reusing error for simplicity
        }

        // Calculate solvency ratio
        uint256 solvencyRatio;
        if (totalLiability == 0) {
            solvencyRatio = type(uint256).max; // Infinite solvency when no liability
        } else {
            solvencyRatio = (poolBalance * RATIO_PRECISION) / totalLiability;
        }

        // Enforce minimum solvency ratio when there is liability
        if (totalLiability > 0 && solvencyRatio < MIN_SOLVENCY_RATIO) {
            revert SolvencyRatioTooLow(solvencyRatio, MIN_SOLVENCY_RATIO);
        }

        // Store the report
        solvencyReports[epochId] = SolvencyReport({
            epochId: epochId,
            poolBalance: poolBalance,
            totalLiability: totalLiability,
            utilizationBps: utilizationBps,
            maxSingleBetExposure: maxSingleBetExposure,
            timestamp: block.timestamp,
            solvencyRatio: solvencyRatio
        });

        latestSolvencyEpochId = epochId;

        emit SolvencyReported(
            epochId,
            poolBalance,
            totalLiability,
            utilizationBps,
            maxSingleBetExposure
        );
    }

    /// @notice Report solvency metrics (called by reporter)
    /// @param epochId Unique epoch identifier (must be monotonically increasing)
    /// @param poolBalance Total pool balance at time of report
    /// @param totalLiability Total outstanding liability
    /// @param utilizationBps Utilization ratio in basis points
    /// @param maxSingleBetExposure Maximum exposure from a single bet
    function reportSolvency(
        uint256 epochId,
        uint256 poolBalance,
        uint256 totalLiability,
        uint256 utilizationBps,
        uint256 maxSingleBetExposure
    ) external onlyReporter {
        _reportSolvency(epochId, poolBalance, totalLiability, utilizationBps, maxSingleBetExposure);
    }

    /// @notice Get a stored solvency report by epoch ID
    /// @param epochId The epoch ID to query
    /// @return The solvency report data
    function getSolvencyReport(uint256 epochId) external view returns (SolvencyReport memory) {
        return solvencyReports[epochId];
    }

    /// @notice Get the latest solvency report
    /// @return The latest solvency report data
    function getLatestSolvencyReport() external view returns (SolvencyReport memory) {
        return solvencyReports[latestSolvencyEpochId];
    }

    // ==================== Reserve Allocation ====================

    /// @notice Allocate reserve to LP distributor (called by distributor)
    /// @param amount Amount to allocate
    /// @param receiver Receiver address for the allocation
    function allocateReserveToLPDistributor(uint256 amount, address receiver) external onlyDistributor {
        if (amount == 0) revert InvalidAmount();
        if (receiver == address(0)) revert ZeroAddress();

        // Note: This is a bookkeeping function. The actual transfer happens
        // through the LPDistributor contract using CCIP (mocked for PoC).
        // The allocation is tracked but assets remain in this contract.

        emit ReserveAllocatedToDistributor(amount, receiver);
    }

    // ==================== View Functions ====================

    /// @notice Get total collateral (LP assets + trader balances)
    /// @return Total collateral in the vault
    function totalCollateral() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /// @notice Get LP value for an address
    /// @param lp LP address
    /// @return LP's share of the pool assets
    function lpValueOf(address lp) external view returns (uint256) {
        if (totalLPShares == 0) return 0;
        return (lpSharesOf[lp] * asset.balanceOf(address(this))) / totalLPShares;
    }

    /// @notice Preview shares for a given deposit amount
    /// @param amount Amount of assets to deposit
    /// @return shares Amount of shares that would be minted
    function previewDepositLP(uint256 amount) external view returns (uint256 shares) {
        if (amount == 0) return 0;
        uint256 totalAssetsBefore = asset.balanceOf(address(this));
        
        if (totalLPShares == 0) {
            shares = amount;
        } else {
            shares = (amount * totalLPShares) / totalAssetsBefore;
        }
    }

    /// @notice Preview assets for a given share amount
    /// @param shares Amount of shares to burn
    /// @return amount Amount of assets that would be returned
    function previewWithdrawLP(uint256 shares) external view returns (uint256 amount) {
        if (shares == 0 || totalLPShares == 0) return 0;
        uint256 totalAssets = asset.balanceOf(address(this));
        amount = (shares * totalAssets) / totalLPShares;
    }
}
