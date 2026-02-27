// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {
    LPDeposited,
    LPWithdrawn,
    TraderDeposited,
    TraderClaimed,
    WithdrawableSet,
    SolvencyReported,
    ReserveAllocatedToDistributor
} from "../src/Events.sol";
import {Roles} from "../src/Roles.sol";
import {
    Unauthorized,
    InvalidAmount,
    ZeroAddress,
    InsufficientShares,
    InsufficientWithdrawable,
    InsufficientBalance,
    SolvencyRatioTooLow
} from "../src/Errors.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";

contract MockERC20 is IERC20 {
    string public name = "Mock USDT";
    string public symbol = "mUSDT";
    uint8 public decimals = 18;
    
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }


}

contract PoolReserveTest is Test {
    PoolReserve public poolReserve;
    Roles public roles;
    MockERC20 public asset;
    
    address public owner = address(1);
    address public reporter = address(2);
    address public settler = address(3);
    address public distributor = address(4);
    address public randomUser = address(99);
    
    address public lp1 = address(10);
    address public lp2 = address(11);
    address public trader1 = address(20);
    address public trader2 = address(21);

    uint256 constant INITIAL_MINT = 1_000_000e18;
    uint256 constant DEPOSIT_AMOUNT = 100_000e18;

    function setUp() public {
        // Deploy mock asset
        asset = new MockERC20();
        
        // Deploy roles
        vm.prank(owner);
        roles = new Roles(owner, reporter, settler, address(0), distributor);
        
        // Deploy PoolReserve
        poolReserve = new PoolReserve(address(roles), address(asset), address(0x999));
        
        // Mint tokens to test addresses
        asset.mint(lp1, INITIAL_MINT);
        asset.mint(lp2, INITIAL_MINT);
        asset.mint(trader1, INITIAL_MINT);
        asset.mint(trader2, INITIAL_MINT);
        asset.mint(randomUser, INITIAL_MINT);
    }

    // ==================== Constructor Tests ====================

    function test_ConstructorSetsRolesAndAsset() public view {
        assertEq(address(poolReserve.roles()), address(roles));
        assertEq(address(poolReserve.asset()), address(asset));
        assertEq(poolReserve.totalLPShares(), 0);
        assertEq(poolReserve.latestSolvencyEpochId(), 0);
    }

    function test_ConstructorRevertsOnZeroRoles() public {
        vm.expectRevert(ZeroAddress.selector);
        new PoolReserve(address(0), address(asset), address(0x999));
    }

    function test_ConstructorRevertsOnZeroAsset() public {
        vm.expectRevert(ZeroAddress.selector);
        new PoolReserve(address(roles), address(0), address(0x999));
    }

    // ==================== LP Deposit Tests ====================

    function test_FirstLPDeposit() public {
        uint256 depositAmount = 1000e18;
        
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), depositAmount);
        
        vm.expectEmit(true, false, false, true);
        emit LPDeposited(lp1, depositAmount, depositAmount);
        
        poolReserve.depositLP(depositAmount);
        vm.stopPrank();

        assertEq(poolReserve.totalLPShares(), depositAmount);
        assertEq(poolReserve.lpSharesOf(lp1), depositAmount);
        assertEq(poolReserve.totalCollateral(), depositAmount);
    }

    function test_MultiLPDeposit() public {
        // LP1 deposits first
        uint256 deposit1 = 1000e18;
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), deposit1);
        poolReserve.depositLP(deposit1);
        vm.stopPrank();

        // LP2 deposits same amount (should get same shares)
        uint256 deposit2 = 1000e18;
        vm.startPrank(lp2);
        asset.approve(address(poolReserve), deposit2);
        poolReserve.depositLP(deposit2);
        vm.stopPrank();

        assertEq(poolReserve.totalLPShares(), deposit1 + deposit2);
        assertEq(poolReserve.lpSharesOf(lp1), deposit1);
        assertEq(poolReserve.lpSharesOf(lp2), deposit2);
    }

    function test_LPDepositWithDifferentRatios() public {
        // LP1 deposits 1000
        uint256 deposit1 = 1000e18;
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), deposit1);
        poolReserve.depositLP(deposit1);
        vm.stopPrank();

        // Pool now has 1000 assets, 1000 shares
        // LP2 deposits 500 - should get 500 shares (1:1 ratio)
        uint256 deposit2 = 500e18;
        vm.startPrank(lp2);
        asset.approve(address(poolReserve), deposit2);
        poolReserve.depositLP(deposit2);
        vm.stopPrank();

        assertEq(poolReserve.lpSharesOf(lp2), deposit2);
    }

    function test_LPDepositRevertsOnZeroAmount() public {
        vm.prank(lp1);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.depositLP(0);
    }

    function test_LPDepositRevertsOnInsufficientApproval() public {
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100e18);
        
        // Try to deposit more than approved
        vm.expectRevert();
        poolReserve.depositLP(200e18);
        vm.stopPrank();
    }

    // ==================== LP Withdraw Tests ====================

    function test_LPWithdraw() public {
        // Setup: LP1 deposits
        uint256 depositAmount = 1000e18;
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), depositAmount);
        poolReserve.depositLP(depositAmount);

        uint256 shares = poolReserve.lpSharesOf(lp1);
        uint256 balanceBefore = asset.balanceOf(lp1);
        
        vm.expectEmit(true, false, false, true);
        emit LPWithdrawn(lp1, shares, depositAmount);
        
        poolReserve.withdrawLP(shares);
        vm.stopPrank();

        assertEq(poolReserve.lpSharesOf(lp1), 0);
        assertEq(poolReserve.totalLPShares(), 0);
        assertEq(asset.balanceOf(lp1), balanceBefore + depositAmount);
    }

    function test_LPPartialWithdraw() public {
        // Setup: LP1 deposits
        uint256 depositAmount = 1000e18;
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), depositAmount);
        poolReserve.depositLP(depositAmount);

        uint256 sharesToWithdraw = 400e18;
        uint256 balanceBefore = asset.balanceOf(lp1);
        
        poolReserve.withdrawLP(sharesToWithdraw);
        vm.stopPrank();

        assertEq(poolReserve.lpSharesOf(lp1), 600e18);
        assertEq(poolReserve.totalLPShares(), 600e18);
        // Should receive proportional assets
        assertEq(asset.balanceOf(lp1), balanceBefore + 400e18);
    }

    function test_LPWithdrawRevertsOnZeroShares() public {
        vm.prank(lp1);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.withdrawLP(0);
    }

    function test_LPWithdrawRevertsOnInsufficientShares() public {
        vm.prank(lp1);
        vm.expectRevert(InsufficientShares.selector);
        poolReserve.withdrawLP(100e18);
    }

    // ==================== Trader Deposit Tests ====================

    function test_TraderDeposit() public {
        uint256 depositAmount = 1000e18;
        
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), depositAmount);
        
        vm.expectEmit(true, false, false, true);
        emit TraderDeposited(trader1, depositAmount);
        
        poolReserve.depositTrader(depositAmount);
        vm.stopPrank();

        assertEq(poolReserve.traderBalanceOf(trader1), depositAmount);
        assertEq(poolReserve.totalTraderBalance(), depositAmount);
        assertEq(poolReserve.totalCollateral(), depositAmount);
    }

    function test_TraderDepositRevertsOnZeroAmount() public {
        vm.prank(trader1);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.depositTrader(0);
    }

    // ==================== Trader Claim Tests ====================

    function test_TraderClaim() public {
        // Setup: Trader deposits
        uint256 depositAmount = 1000e18;
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), depositAmount);
        poolReserve.depositTrader(depositAmount);
        vm.stopPrank();

        // Settler sets withdrawable
        vm.prank(settler);
        poolReserve.setWithdrawable(trader1, 500e18);

        // Trader claims
        uint256 claimAmount = 300e18;
        uint256 balanceBefore = asset.balanceOf(trader1);
        
        vm.startPrank(trader1);
        vm.expectEmit(true, false, false, true);
        emit TraderClaimed(trader1, claimAmount);
        
        poolReserve.claimTrader(claimAmount);
        vm.stopPrank();

        assertEq(poolReserve.traderWithdrawableOf(trader1), 200e18);
        assertEq(poolReserve.traderBalanceOf(trader1), 700e18);
        assertEq(poolReserve.totalTraderBalance(), 700e18);
        assertEq(asset.balanceOf(trader1), balanceBefore + claimAmount);
    }

    function test_TraderClaimRevertsOnInsufficientWithdrawable() public {
        // Setup: Trader deposits
        uint256 depositAmount = 1000e18;
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), depositAmount);
        poolReserve.depositTrader(depositAmount);
        vm.stopPrank();

        // Settler sets withdrawable to 500
        vm.prank(settler);
        poolReserve.setWithdrawable(trader1, 500e18);

        // Trader tries to claim more than withdrawable
        vm.prank(trader1);
        vm.expectRevert(InsufficientWithdrawable.selector);
        poolReserve.claimTrader(600e18);
    }

    function test_TraderClaimRevertsOnInsufficientBalance() public {
        // Setup: Trader deposits
        uint256 depositAmount = 1000e18;
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), depositAmount);
        poolReserve.depositTrader(depositAmount);
        vm.stopPrank();

        // Settler sets withdrawable higher than balance (edge case)
        vm.prank(settler);
        poolReserve.setWithdrawable(trader1, 2000e18);

        // Trader tries to claim more than balance
        vm.prank(trader1);
        vm.expectRevert(InsufficientBalance.selector);
        poolReserve.claimTrader(1500e18);
    }

    // ==================== SetWithdrawable Tests ====================

    function test_SetWithdrawable() public {
        vm.prank(settler);
        
        vm.expectEmit(true, false, false, true);
        emit WithdrawableSet(trader1, 500e18);
        
        poolReserve.setWithdrawable(trader1, 500e18);

        assertEq(poolReserve.traderWithdrawableOf(trader1), 500e18);
    }

    function test_SetWithdrawableRevertsForNonSettler() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        poolReserve.setWithdrawable(trader1, 500e18);
    }

    // ==================== Solvency Reporting Tests ====================

    function test_ReportSolvencyPass() public {
        uint256 epochId = 1;
        uint256 poolBalance = 1000e18;
        uint256 totalLiability = 500e18;
        uint256 utilizationBps = 5000;
        uint256 maxSingleBetExposure = 100e18;

        vm.prank(reporter);
        
        vm.expectEmit(true, false, false, true);
        emit SolvencyReported(
            epochId,
            poolBalance,
            totalLiability,
            utilizationBps,
            maxSingleBetExposure
        );
        
        poolReserve.reportSolvency(
            epochId,
            poolBalance,
            totalLiability,
            utilizationBps,
            maxSingleBetExposure
        );

        PoolReserve.SolvencyReport memory report = poolReserve.getSolvencyReport(epochId);
        assertEq(report.epochId, epochId);
        assertEq(report.poolBalance, poolBalance);
        assertEq(report.totalLiability, totalLiability);
        assertEq(report.utilizationBps, utilizationBps);
        assertEq(report.maxSingleBetExposure, maxSingleBetExposure);
        assertEq(report.solvencyRatio, 2e18); // 1000/500 = 2.0
    }

    function test_ReportSolvencyExactRatio() public {
        // Ratio = 1.5 exactly (at threshold)
        uint256 poolBalance = 1500e18;
        uint256 totalLiability = 1000e18;

        vm.prank(reporter);
        poolReserve.reportSolvency(1, poolBalance, totalLiability, 0, 0);

        PoolReserve.SolvencyReport memory report = poolReserve.getLatestSolvencyReport();
        assertEq(report.solvencyRatio, 1.5e18);
    }

    function test_ReportSolvencyZeroLiability() public {
        // Zero liability should always pass (infinite solvency)
        vm.prank(reporter);
        poolReserve.reportSolvency(1, 1000e18, 0, 0, 0);

        PoolReserve.SolvencyReport memory report = poolReserve.getLatestSolvencyReport();
        assertEq(report.solvencyRatio, type(uint256).max);
    }

    function test_ReportSolvencyRevertsOnLowRatio() public {
        // Ratio = 1.4 (below 1.5 threshold)
        uint256 poolBalance = 1400e18;
        uint256 totalLiability = 1000e18;

        vm.prank(reporter);
        vm.expectRevert(abi.encodeWithSelector(SolvencyRatioTooLow.selector, 1.4e18, 1.5e18));
        poolReserve.reportSolvency(1, poolBalance, totalLiability, 0, 0);
    }

    function test_ReportSolvencyRevertsOnStaleEpoch() public {
        // Report epoch 2 first
        vm.prank(reporter);
        poolReserve.reportSolvency(2, 1000e18, 500e18, 0, 0);

        // Try to report epoch 1 (should fail)
        vm.prank(reporter);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.reportSolvency(1, 1000e18, 500e18, 0, 0);
    }

    function test_ReportSolvencyRevertsForNonReporter() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        poolReserve.reportSolvency(1, 1000e18, 500e18, 0, 0);
    }

    // ==================== Reserve Allocation Tests ====================

    function test_AllocateReserveToDistributor() public {
        uint256 amount = 500e18;
        address receiver = address(100);

        vm.prank(distributor);
        
        vm.expectEmit(true, true, false, true);
        emit ReserveAllocatedToDistributor(amount, receiver);
        
        poolReserve.allocateReserveToLPDistributor(amount, receiver);
    }

    function test_AllocateReserveRevertsOnZeroAmount() public {
        vm.prank(distributor);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.allocateReserveToLPDistributor(0, address(100));
    }

    function test_AllocateReserveRevertsOnZeroReceiver() public {
        vm.prank(distributor);
        vm.expectRevert(ZeroAddress.selector);
        poolReserve.allocateReserveToLPDistributor(100e18, address(0));
    }

    function test_AllocateReserveRevertsForNonDistributor() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        poolReserve.allocateReserveToLPDistributor(100e18, address(100));
    }

    // ==================== View Function Tests ====================

    function test_TotalCollateral() public {
        // LP deposits
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositLP(1000e18);
        vm.stopPrank();

        // Trader deposits
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), 500e18);
        poolReserve.depositTrader(500e18);
        vm.stopPrank();

        assertEq(poolReserve.totalCollateral(), 1500e18);
    }

    function test_LPValueOf() public {
        // LP1 deposits
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositLP(1000e18);
        vm.stopPrank();

        // LP2 deposits
        vm.startPrank(lp2);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositLP(1000e18);
        vm.stopPrank();

        // Each LP should have value of 1000e18 (half of total)
        assertEq(poolReserve.lpValueOf(lp1), 1000e18);
        assertEq(poolReserve.lpValueOf(lp2), 1000e18);
    }

    function test_PreviewDepositLP() public {
        // Before any deposits
        assertEq(poolReserve.previewDepositLP(1000e18), 1000e18);

        // After first deposit
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositLP(1000e18);
        vm.stopPrank();

        // New deposit should get proportional shares
        assertEq(poolReserve.previewDepositLP(500e18), 500e18);
    }

    function test_PreviewWithdrawLP() public {
        // Before any deposits
        assertEq(poolReserve.previewWithdrawLP(1000e18), 0);

        // After deposit
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositLP(1000e18);
        vm.stopPrank();

        // Withdraw preview
        assertEq(poolReserve.previewWithdrawLP(500e18), 500e18);
    }

    // ==================== Integration Tests ====================

    function test_LPAndTraderTogether() public {
        // LP1 deposits
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 1000e18);
        poolReserve.depositLP(1000e18);
        vm.stopPrank();

        // Trader1 deposits
        vm.startPrank(trader1);
        asset.approve(address(poolReserve), 500e18);
        poolReserve.depositTrader(500e18);
        vm.stopPrank();

        // Check state
        assertEq(poolReserve.totalCollateral(), 1500e18);
        assertEq(poolReserve.totalLPShares(), 1000e18);
        assertEq(poolReserve.totalTraderBalance(), 500e18);

        // Set withdrawable and claim
        vm.prank(settler);
        poolReserve.setWithdrawable(trader1, 300e18);

        vm.prank(trader1);
        poolReserve.claimTrader(200e18);

        assertEq(poolReserve.totalCollateral(), 1300e18);
        assertEq(poolReserve.totalTraderBalance(), 300e18);

        // LP withdraws
        vm.prank(lp1);
        poolReserve.withdrawLP(500e18);

        // LP should get proportional share (650e18 since total is now 1300e18)
        assertEq(poolReserve.totalCollateral(), 650e18);
        assertEq(poolReserve.totalLPShares(), 500e18);
    }

    function test_FirstLPBootstrap() public {
        // First LP gets 1:1 shares
        uint256 depositAmount = 1e18; // Small amount
        
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), depositAmount);
        poolReserve.depositLP(depositAmount);
        vm.stopPrank();

        assertEq(poolReserve.lpSharesOf(lp1), depositAmount);
        assertEq(poolReserve.totalLPShares(), depositAmount);
    }

    // ==================== IReceiver / onReport Tests ====================

    function test_OnReport_Success() public {
        // Setup - LP deposits
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        // Encode report
        bytes memory report = abi.encode(
            uint256(1), // epochId
            uint256(100_000e18), // poolBalance
            uint256(0), // totalLiability
            uint256(0), // utilizationBps
            uint256(10_000e18) // maxSingleBetExposure
        );

        // Call onReport as forwarder
        vm.prank(address(0x999));
        vm.expectEmit(true, false, false, true);
        emit SolvencyReported(
            uint256(1),
            uint256(100_000e18),
            uint256(0),
            uint256(0),
            uint256(10_000e18)
        );
        poolReserve.onReport("", report);

        // Verify report was stored
        assertEq(poolReserve.latestSolvencyEpochId(), 1);
    }

    function test_OnReport_RevertInvalidSender() public {
        bytes memory report = abi.encode(
            uint256(1),
            uint256(100_000e18),
            uint256(0),
            uint256(0),
            uint256(10_000e18)
        );

        // Call onReport as non-forwarder should revert
        vm.prank(lp1);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("InvalidSender(address,address)")),
            lp1,
            address(0x999)
        ));
        poolReserve.onReport("", report);
    }

    function test_OnReport_MultipleEpochs() public {
        // Setup
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 200_000e18);
        poolReserve.depositLP(200_000e18);
        vm.stopPrank();

        // Epoch 1
        vm.prank(address(0x999));
        poolReserve.onReport("", abi.encode(
            uint256(1),
            uint256(100_000e18),
            uint256(0),
            uint256(0),
            uint256(10_000e18)
        ));

        // Epoch 2
        vm.prank(address(0x999));
        poolReserve.onReport("", abi.encode(
            uint256(2),
            uint256(150_000e18),
            uint256(10_000e18),
            uint256(666), // utilization
            uint256(10_000e18)
        ));

        assertEq(poolReserve.latestSolvencyEpochId(), 2);
    }

    function test_SupportsInterface() public view {
        // IReceiver interface ID
        bytes4 receiverInterface = type(IReceiver).interfaceId;
        assertTrue(poolReserve.supportsInterface(receiverInterface));

        // ERC165 interface ID
        bytes4 erc165Interface = 0x01ffc9a7;
        assertTrue(poolReserve.supportsInterface(erc165Interface));
    }

    function test_ForwarderAddressGetter() public view {
        assertEq(poolReserve.getForwarderAddress(), address(0x999));
    }
}
