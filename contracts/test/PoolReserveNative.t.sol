// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {PoolReserveNative} from "../src/PoolReserveNative.sol";
import {LPDeposited, LPWithdrawn, TraderDeposited, TraderClaimed} from "../src/Events.sol";
import {InvalidAmount, InsufficientShares, InsufficientCollateral} from "../src/Errors.sol";

contract PoolReserveNativeTest is Test {
    PoolReserveNative public poolReserve;
    address public randomUser = address(0x199);
    address public lp1 = address(0x10A);
    address public lp2 = address(0x10B);
    address public trader1 = address(0x114);

    function setUp() public {
        poolReserve = new PoolReserveNative();

        vm.deal(lp1, 1_000 ether);
        vm.deal(lp2, 1_000 ether);
        vm.deal(trader1, 1_000 ether);
        vm.deal(randomUser, 1_000 ether);
    }

    function test_ConstructorStartsEmpty() public view {
        assertEq(poolReserve.totalLPShares(), 0);
    }

    function test_FirstLPDeposit() public {
        uint256 depositAmount = 10 ether;

        vm.prank(lp1);
        vm.expectEmit(true, false, false, true);
        emit LPDeposited(lp1, depositAmount, depositAmount);
        poolReserve.depositLP{value: depositAmount}();

        assertEq(poolReserve.totalLPShares(), depositAmount);
        assertEq(poolReserve.lpSharesOf(lp1), depositAmount);
        assertEq(poolReserve.totalCollateral(), depositAmount);
    }

    function test_MultiLPDepositMintsProportionalShares() public {
        vm.prank(lp1);
        poolReserve.depositLP{value: 10 ether}();

        vm.prank(lp2);
        poolReserve.depositLP{value: 5 ether}();

        assertEq(poolReserve.totalLPShares(), 15 ether);
        assertEq(poolReserve.lpSharesOf(lp1), 10 ether);
        assertEq(poolReserve.lpSharesOf(lp2), 5 ether);
    }

    function test_LPWithdrawReturnsNativeCoin() public {
        vm.prank(lp1);
        poolReserve.depositLP{value: 10 ether}();

        uint256 balanceBefore = lp1.balance;

        vm.prank(lp1);
        vm.expectEmit(true, false, false, true);
        emit LPWithdrawn(lp1, 10 ether, 10 ether);
        poolReserve.withdrawLP(10 ether);

        assertEq(poolReserve.totalLPShares(), 0);
        assertEq(poolReserve.lpSharesOf(lp1), 0);
        assertEq(lp1.balance, balanceBefore + 10 ether);
    }

    function test_LPWithdrawRevertsOnInsufficientShares() public {
        vm.prank(lp1);
        poolReserve.depositLP{value: 1 ether}();

        vm.prank(lp1);
        vm.expectRevert(InsufficientShares.selector);
        poolReserve.withdrawLP(2 ether);
    }

    function test_TraderDepositEmitsEvent() public {
        vm.prank(trader1);
        vm.expectEmit(true, false, false, true);
        emit TraderDeposited(trader1, 3 ether);
        poolReserve.depositTrader{value: 3 ether}();

        assertEq(poolReserve.totalCollateral(), 3 ether);
    }

    function test_ClaimTraderTransfersNativeCoin() public {
        vm.prank(trader1);
        poolReserve.depositTrader{value: 4 ether}();

        uint256 balanceBefore = trader1.balance;

        vm.prank(trader1);
        vm.expectEmit(true, false, false, true);
        emit TraderClaimed(trader1, 1 ether);
        poolReserve.claimTrader(1 ether);

        assertEq(trader1.balance, balanceBefore + 1 ether);
        assertEq(poolReserve.totalCollateral(), 3 ether);
    }

    function test_ClaimTraderRevertsOnInsufficientCollateral() public {
        vm.prank(trader1);
        poolReserve.depositTrader{value: 1 ether}();

        vm.prank(trader1);
        vm.expectRevert(InsufficientCollateral.selector);
        poolReserve.claimTrader(2 ether);
    }

    function test_ReceiveReverts() public {
        vm.prank(randomUser);
        vm.expectRevert(InvalidAmount.selector);
        payable(address(poolReserve)).transfer(1 ether);
    }
}
