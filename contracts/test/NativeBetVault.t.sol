// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {NativeBetVault} from "../src/NativeBetVault.sol";

contract NativeBetVaultTest is Test {
    NativeBetVault internal vault;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA12);
    address internal outsider = address(0x0A77);

    function setUp() public {
        vault = new NativeBetVault();

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
        vm.deal(outsider, 10 ether);
    }

    function test_BetStoresRoundState() public {
        vm.prank(alice);
        vault.bet{value: 2 ether}(1, 1);

        (uint256 totalPot, uint256 totalOnOutcome0, uint256 totalOnOutcome1, bool resolved, uint8 winningOutcome) =
            vault.getRound(1);

        assertEq(totalPot, 2 ether);
        assertEq(totalOnOutcome0, 0);
        assertEq(totalOnOutcome1, 2 ether);
        assertFalse(resolved);
        assertEq(winningOutcome, 0);
        assertEq(vault.betAmountOf(1, alice), 2 ether);
        assertEq(vault.outcomeOf(1, alice), 1);
    }

    function test_BetAllowsTopUpOnSameOutcome() public {
        vm.startPrank(alice);
        vault.bet{value: 1 ether}(1, 0);
        vault.bet{value: 3 ether}(1, 0);
        vm.stopPrank();

        assertEq(vault.betAmountOf(1, alice), 4 ether);

        (
            uint256 totalPot,
            uint256 totalOnOutcome0,
            uint256 totalOnOutcome1,
            bool resolved,
            uint8 winningOutcome
        ) = vault.getRound(1);
        assertEq(totalPot, 4 ether);
        assertEq(totalOnOutcome0, 4 ether);
        assertEq(totalOnOutcome1, 0);
        assertFalse(resolved);
        assertEq(winningOutcome, 0);
    }

    function test_BetRevertsWhenSwitchingOutcome() public {
        vm.prank(alice);
        vault.bet{value: 1 ether}(1, 0);

        vm.prank(alice);
        vm.expectRevert(NativeBetVault.BetOnDifferentOutcome.selector);
        vault.bet{value: 1 ether}(1, 1);
    }

    function test_ResolvePaysWinnersProRata() public {
        vm.prank(alice);
        vault.bet{value: 1 ether}(1, 0);

        vm.prank(bob);
        vault.bet{value: 3 ether}(1, 0);

        vm.prank(carol);
        vault.bet{value: 2 ether}(1, 1);

        uint256 aliceBalanceBefore = alice.balance;
        uint256 bobBalanceBefore = bob.balance;
        uint256 carolBalanceBefore = carol.balance;

        vault.resolve(1, 0);

        assertEq(alice.balance, aliceBalanceBefore + 1.5 ether);
        assertEq(bob.balance, bobBalanceBefore + 4.5 ether);
        assertEq(carol.balance, carolBalanceBefore);
        assertEq(address(vault).balance, 0);

        (
            uint256 totalPot,
            uint256 totalOnOutcome0,
            uint256 totalOnOutcome1,
            bool resolved,
            uint8 winningOutcome
        ) = vault.getRound(1);
        assertEq(totalPot, 6 ether);
        assertEq(totalOnOutcome0, 4 ether);
        assertEq(totalOnOutcome1, 2 ether);
        assertTrue(resolved);
        assertEq(winningOutcome, 0);
    }

    function test_ResolveSendsPotToOwnerWhenNoWinner() public {
        vm.prank(alice);
        vault.bet{value: 2 ether}(1, 0);

        uint256 ownerBalanceBefore = address(this).balance;

        vault.resolve(1, 1);

        assertEq(address(this).balance, ownerBalanceBefore + 2 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_ResolveRevertsForNonOwner() public {
        vm.prank(alice);
        vault.bet{value: 1 ether}(1, 0);

        vm.prank(outsider);
        vm.expectRevert(NativeBetVault.Unauthorized.selector);
        vault.resolve(1, 0);
    }

    function test_ReceiveReverts() public {
        vm.prank(alice);
        vm.expectRevert(NativeBetVault.InvalidAmount.selector);
        payable(address(vault)).transfer(1 ether);
    }

    receive() external payable {}
}
