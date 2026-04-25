// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Settlement} from "../src/Settlement.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {PoolReserveProxy} from "../src/PoolReserveProxy.sol";
import {Roles} from "../src/Roles.sol";
import {MockERC20} from "./PoolReserve.t.sol";
import {InvalidSignature} from "../src/Errors.sol";

contract SettlementPoolReserveIntegrationTest is Test {
    Settlement public settlement;
    PoolReserve public poolReserve;
    Roles public roles;
    MockERC20 public asset;

    uint256 internal signerKey = 0xB0B;
    address public owner = address(1);
    address public reporter = address(2);
    address public distributor = address(4);
    address public claimSigner;
    address public trader1 = address(20);

    bytes32 constant BATCH_ID = keccak256("integration_batch");
    uint256 constant TRADER_DEPOSIT = 5000e18;
    uint256 constant WINNING_PAYOUT = 1000e18;

    function setUp() public {
        claimSigner = vm.addr(signerKey);
        asset = new MockERC20();

        vm.prank(owner);
        roles = new Roles(owner, reporter, owner, address(0), distributor);

        PoolReserve implementation = new PoolReserve();
        PoolReserveProxy proxy = new PoolReserveProxy(
            address(implementation),
            abi.encodeCall(PoolReserve.initialize, (owner, address(asset), claimSigner))
        );
        poolReserve = PoolReserve(address(proxy));
        settlement = new Settlement(address(roles), address(poolReserve), address(0x999));

        vm.prank(owner);
        roles.setSettler(address(settlement));

        asset.mint(trader1, 100_000e18);
    }

    function test_FullSettlementFlowWithSignedTraderClaim() public {
        _deposit(trader1, TRADER_DEPOSIT);
        assertEq(poolReserve.totalCollateral(), TRADER_DEPOSIT);

        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID,
            keccak256("merkle_root"),
            WINNING_PAYOUT,
            TRADER_DEPOSIT,
            block.timestamp,
            block.timestamp + 300
        );

        vm.prank(owner);
        settlement.markPaid(trader1, WINNING_PAYOUT, BATCH_ID);
        assertEq(settlement.getPaidAmount(BATCH_ID, trader1), WINNING_PAYOUT);

        uint256 balanceBefore = asset.balanceOf(trader1);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(trader1, WINNING_PAYOUT, deadline);

        vm.prank(trader1);
        poolReserve.claimTrader(WINNING_PAYOUT, deadline, signature);

        assertEq(asset.balanceOf(trader1), balanceBefore + WINNING_PAYOUT);
        assertEq(poolReserve.totalCollateral(), TRADER_DEPOSIT - WINNING_PAYOUT);
        assertEq(poolReserve.traderBalanceOf(trader1), TRADER_DEPOSIT - WINNING_PAYOUT);
    }

    function test_MultiTraderSettlementFlowWithSignedClaims() public {
        address trader2 = address(21);
        address trader3 = address(22);
        asset.mint(trader2, 10_000e18);
        asset.mint(trader3, 10_000e18);

        _deposit(trader1, 1000e18);
        _deposit(trader2, 2000e18);
        _deposit(trader3, 3000e18);

        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID,
            keccak256("multi_trader_merkle"),
            1500e18,
            6000e18,
            block.timestamp,
            block.timestamp + 300
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(trader1, 500e18, deadline);

        uint256 trader1BalanceBefore = asset.balanceOf(trader1);
        vm.prank(trader1);
        poolReserve.claimTrader(500e18, deadline, signature);

        assertEq(asset.balanceOf(trader1), trader1BalanceBefore + 500e18);
        assertEq(poolReserve.totalCollateral(), 5500e18);
    }

    function test_SignedClaimRejectsReplayAfterSettlement() public {
        _deposit(trader1, TRADER_DEPOSIT);

        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID,
            keccak256("replay_merkle"),
            WINNING_PAYOUT,
            TRADER_DEPOSIT,
            block.timestamp,
            block.timestamp + 300
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(trader1, WINNING_PAYOUT, deadline);

        vm.prank(trader1);
        poolReserve.claimTrader(WINNING_PAYOUT, deadline, signature);

        vm.prank(trader1);
        vm.expectRevert(InvalidSignature.selector);
        poolReserve.claimTrader(WINNING_PAYOUT, deadline, signature);
    }

    function test_SequentialSettlementsUseFreshNonces() public {
        _deposit(trader1, 10_000e18);
        uint256 initialCollateral = poolReserve.totalCollateral();

        bytes32 batch1 = keccak256("batch_1");
        vm.prank(owner);
        settlement.commitSettlementBatch(
            batch1,
            keccak256("merkle_1"),
            2000e18,
            10_000e18,
            block.timestamp,
            block.timestamp + 300
        );

        uint256 deadline1 = block.timestamp + 1 hours;
        bytes memory signature1 = _signClaim(trader1, 2000e18, deadline1);

        vm.prank(trader1);
        poolReserve.claimTrader(2000e18, deadline1, signature1);

        bytes32 batch2 = keccak256("batch_2");
        vm.prank(owner);
        settlement.commitSettlementBatch(
            batch2,
            keccak256("merkle_2"),
            3000e18,
            8000e18,
            block.timestamp + 300,
            block.timestamp + 600
        );

        uint256 deadline2 = block.timestamp + 2 hours;
        bytes memory signature2 = _signClaim(trader1, 3000e18, deadline2);

        vm.prank(trader1);
        poolReserve.claimTrader(3000e18, deadline2, signature2);

        assertEq(poolReserve.totalCollateral(), initialCollateral - 5000e18);
        assertEq(poolReserve.nonces(trader1), 2);
        assertTrue(settlement.getBatch(batch1).exists);
        assertTrue(settlement.getBatch(batch2).exists);
        assertEq(settlement.batchCount(), 2);
    }

    function _deposit(address account, uint256 amount) internal {
        vm.startPrank(account);
        asset.approve(address(poolReserve), amount);
        poolReserve.depositTrader(amount);
        vm.stopPrank();
    }

    function _signClaim(address account, uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = poolReserve.getClaimDigest(
            account,
            amount,
            poolReserve.nonces(account),
            deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
