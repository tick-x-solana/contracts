// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Settlement} from "../src/Settlement.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {Roles} from "../src/Roles.sol";
import {MockERC20} from "./PoolReserve.t.sol";
import {Unauthorized, InvalidAmount, ZeroAddress, DuplicateBatchId, InvalidWindow} from "../src/Errors.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";
import {SettlementBatchCommitted, PaidMarked} from "../src/Events.sol";

contract SettlementTest is Test {
    Settlement public settlement;
    PoolReserve public poolReserve;
    Roles public roles;
    MockERC20 public asset;
    
    address public owner = address(1);
    address public reporter = address(2);
    address public settler = address(3);
    address public distributor = address(4);
    address public randomUser = address(99);
    
    address public trader1 = address(20);
    address public trader2 = address(21);

    bytes32 constant BATCH_ID_1 = keccak256("batch_1");
    bytes32 constant BATCH_ID_2 = keccak256("batch_2");
    bytes32 constant MERKLE_ROOT = keccak256("merkle_root");
    uint256 constant TOTAL_PAYOUT = 10000e18;
    uint256 constant WITHDRAWABLE_CAP = 5000e18;
    uint256 constant WINDOW_START = 1704067200;
    uint256 constant WINDOW_END = 1704067800;

    function setUp() public {
        // Deploy mock asset
        asset = new MockERC20();
        
        // Deploy roles - settlement will use owner for access control
        vm.prank(owner);
        roles = new Roles(owner, reporter, address(0), address(0), distributor);
        
        // Deploy PoolReserve
        poolReserve = new PoolReserve(address(roles), address(asset), address(0x999));
        
        // Deploy Settlement (pointing to poolReserve, but we'll update roles after)
        settlement = new Settlement(address(roles), address(poolReserve), address(0x999));
        
        // Set Settlement contract as the settler in PoolReserve via Roles
        // This allows Settlement to call setWithdrawable on PoolReserve
        vm.prank(owner);
        roles.setSettler(address(settlement));
        
        // Mint tokens to traders
        asset.mint(trader1, 100_000e18);
        asset.mint(trader2, 100_000e18);
    }

    // ==================== Constructor Tests ====================

    function test_ConstructorSetsRolesAndPoolReserve() public view {
        assertEq(address(settlement.roles()), address(roles));
        assertEq(address(settlement.poolReserve()), address(poolReserve));
        assertEq(settlement.batchCount(), 0);
    }

    function test_ConstructorRevertsOnZeroRoles() public {
        vm.expectRevert(ZeroAddress.selector);
        new Settlement(address(0), address(poolReserve), address(0x999));
    }

    function test_ConstructorRevertsOnZeroPoolReserve() public {
        vm.expectRevert(ZeroAddress.selector);
        new Settlement(address(roles), address(0), address(0x999));
    }

    // ==================== Commit Settlement Batch Tests ====================

    function test_CommitSettlementBatch() public {
        vm.prank(owner);
        
        vm.expectEmit(true, false, false, true);
        emit SettlementBatchCommitted(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
        
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        assertEq(settlement.batchCount(), 1);
        
        Settlement.Batch memory batch = settlement.getBatch(BATCH_ID_1);
        assertEq(batch.batchId, BATCH_ID_1);
        assertEq(batch.merkleRoot, MERKLE_ROOT);
        assertEq(batch.totalPayout, TOTAL_PAYOUT);
        assertEq(batch.withdrawableCap, WITHDRAWABLE_CAP);
        assertEq(batch.windowStart, WINDOW_START);
        assertEq(batch.windowEnd, WINDOW_END);
        assertTrue(batch.exists);
    }

    function test_CommitMultipleBatches() public {
        vm.startPrank(owner);
        
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
        
        settlement.commitSettlementBatch(
            BATCH_ID_2,
            keccak256("merkle_root_2"),
            20000e18,
            10000e18,
            WINDOW_END,
            WINDOW_END + 600
        );
        
        vm.stopPrank();

        assertEq(settlement.batchCount(), 2);
        assertTrue(settlement.getBatch(BATCH_ID_1).exists);
        assertTrue(settlement.getBatch(BATCH_ID_2).exists);
    }

    function test_CommitRevertsForNonOwner() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
    }

    function test_CommitRevertsOnZeroBatchId() public {
        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        settlement.commitSettlementBatch(
            bytes32(0),
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
    }

    function test_CommitRevertsOnDuplicateBatchId() public {
        vm.startPrank(owner);
        
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
        
        vm.expectRevert(abi.encodeWithSelector(DuplicateBatchId.selector, BATCH_ID_1));
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
        
        vm.stopPrank();
    }

    function test_CommitRevertsOnInvalidWindow() public {
        vm.prank(owner);
        vm.expectRevert(InvalidWindow.selector);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_END, // Start after end
            WINDOW_START
        );
    }

    function test_CommitRevertsOnEqualWindowTimes() public {
        vm.prank(owner);
        vm.expectRevert(InvalidWindow.selector);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_START // Same as start
        );
    }

    // ==================== Mark Paid Tests ====================

    function test_MarkPaid() public {
        // First commit a batch
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        // Mark paid
        uint256 paidAmt = 100e18;
        vm.prank(owner);
        
        vm.expectEmit(true, false, false, true);
        emit PaidMarked(trader1, paidAmt);
        
        settlement.markPaid(trader1, paidAmt, BATCH_ID_1);

        assertEq(settlement.getPaidAmount(BATCH_ID_1, trader1), paidAmt);
    }

    function test_MarkPaidAccumulates() public {
        // First commit a batch
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        // Mark paid twice
        vm.startPrank(owner);
        settlement.markPaid(trader1, 100e18, BATCH_ID_1);
        settlement.markPaid(trader1, 200e18, BATCH_ID_1);
        vm.stopPrank();

        assertEq(settlement.getPaidAmount(BATCH_ID_1, trader1), 300e18);
    }

    function test_MarkPaidRevertsForNonSettler() public {
        // First commit a batch
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        settlement.markPaid(trader1, 100e18, BATCH_ID_1);
    }

    function test_MarkPaidRevertsOnZeroAccount() public {
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        settlement.markPaid(address(0), 100e18, BATCH_ID_1);
    }

    function test_MarkPaidRevertsOnZeroAmount() public {
        vm.prank(owner);
        settlement.commitSettlementBatch(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        settlement.markPaid(trader1, 0, BATCH_ID_1);
    }

    function test_MarkPaidRevertsOnNonExistentBatch() public {
        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        settlement.markPaid(trader1, 100e18, BATCH_ID_1);
    }

    // ==================== Set Withdrawable Via Pool Reserve Tests ====================

    function test_SetWithdrawableViaPoolReserve() public {
        uint256 withdrawableAmount = 500e18;
        
        vm.prank(owner);
        settlement.setWithdrawableViaPoolReserve(trader1, withdrawableAmount);

        assertEq(poolReserve.traderWithdrawableOf(trader1), withdrawableAmount);
    }

    function test_SetWithdrawableViaPoolReserveRevertsForNonOwner() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        settlement.setWithdrawableViaPoolReserve(trader1, 500e18);
    }

    // ==================== Batch Set Withdrawable Tests ====================

    function test_BatchSetWithdrawable() public {
        address[] memory accounts = new address[](2);
        accounts[0] = trader1;
        accounts[1] = trader2;
        
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500e18;
        amounts[1] = 1000e18;

        vm.prank(owner);
        settlement.batchSetWithdrawable(accounts, amounts);

        assertEq(poolReserve.traderWithdrawableOf(trader1), 500e18);
        assertEq(poolReserve.traderWithdrawableOf(trader2), 1000e18);
    }

    function test_BatchSetWithdrawableRevertsOnMismatchedArrays() public {
        address[] memory accounts = new address[](2);
        accounts[0] = trader1;
        accounts[1] = trader2;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 500e18;

        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        settlement.batchSetWithdrawable(accounts, amounts);
    }

    function test_BatchSetWithdrawableRevertsOnEmptyArrays() public {
        address[] memory accounts = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        settlement.batchSetWithdrawable(accounts, amounts);
    }

    function test_BatchSetWithdrawableRevertsOnZeroAddress() public {
        address[] memory accounts = new address[](2);
        accounts[0] = trader1;
        accounts[1] = address(0);
        
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500e18;
        amounts[1] = 1000e18;

        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        settlement.batchSetWithdrawable(accounts, amounts);
    }

    function test_BatchSetWithdrawableRevertsForNonOwner() public {
        address[] memory accounts = new address[](1);
        accounts[0] = trader1;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 500e18;

        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        settlement.batchSetWithdrawable(accounts, amounts);
    }

    // ==================== IReceiver / onReport Tests ====================

    function test_OnReport_Success() public {
        // Encode report
        bytes memory report = abi.encode(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        // Call onReport as forwarder (address(0x999) was set in setUp)
        vm.prank(address(0x999));
        vm.expectEmit(true, false, false, true);
        emit SettlementBatchCommitted(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );
        settlement.onReport("", report);

        // Verify batch was committed
        assertEq(settlement.batchCount(), 1);
        Settlement.Batch memory batch = settlement.getBatch(BATCH_ID_1);
        assertTrue(batch.exists);
        assertEq(batch.merkleRoot, MERKLE_ROOT);
    }

    function test_OnReport_RevertInvalidSender() public {
        bytes memory report = abi.encode(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        );

        // Call onReport as non-forwarder should revert
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("InvalidSender(address,address)")),
            randomUser,
            address(0x999)
        ));
        settlement.onReport("", report);
    }

    function test_OnReport_MultipleBatches() public {
        // First batch
        vm.prank(address(0x999));
        settlement.onReport("", abi.encode(
            BATCH_ID_1,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START,
            WINDOW_END
        ));

        // Second batch via onReport
        bytes32 batchId2 = keccak256("batch_2");
        vm.prank(address(0x999));
        settlement.onReport("", abi.encode(
            batchId2,
            MERKLE_ROOT,
            TOTAL_PAYOUT,
            WITHDRAWABLE_CAP,
            WINDOW_START + 1000,
            WINDOW_END + 1000
        ));

        assertEq(settlement.batchCount(), 2);
    }

    function test_SupportsInterface() public view {
        // IReceiver interface ID
        bytes4 receiverInterface = type(IReceiver).interfaceId;
        assertTrue(settlement.supportsInterface(receiverInterface));

        // ERC165 interface ID
        bytes4 erc165Interface = 0x01ffc9a7;
        assertTrue(settlement.supportsInterface(erc165Interface));
    }

    function test_ForwarderAddressGetter() public view {
        assertEq(settlement.getForwarderAddress(), address(0x999));
    }
}
