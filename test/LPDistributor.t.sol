// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {LPDistributor} from "../src/LPDistributor.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {Roles} from "../src/Roles.sol";
import {MockERC20} from "./PoolReserve.t.sol";
import {Unauthorized, InvalidAmount, ZeroAddress} from "../src/Errors.sol";
import {CCIPDistributionRequested, ReserveAllocatedToDistributor} from "../src/Events.sol";

contract LPDistributorTest is Test {
    LPDistributor public lpDistributor;
    PoolReserve public poolReserve;
    Roles public roles;
    MockERC20 public asset;
    
    address public owner = address(1);
    address public reporter = address(2);
    address public settler = address(3);
    address public distributor = address(4);
    address public randomUser = address(99);
    
    address public lp1 = address(10);
    address public receiver = address(100);

    uint256 constant INITIAL_LP_DEPOSIT = 100_000e18;
    uint64 constant DST_CHAIN_SELECTOR = 16015286601757825753; // Ethereum Sepolia

    function setUp() public {
        // Deploy mock asset
        asset = new MockERC20();
        
        // Deploy roles with owner as placeholder distributor
        vm.prank(owner);
        roles = new Roles(owner, reporter, settler, address(0), owner);
        
        // Deploy PoolReserve
        poolReserve = new PoolReserve(address(roles), address(asset));
        
        // Deploy LPDistributor
        lpDistributor = new LPDistributor(address(roles), address(poolReserve));
        
        // Set LPDistributor as the distributor in Roles
        vm.prank(owner);
        roles.setDistributor(address(lpDistributor));
        
        // Mint tokens to LP
        asset.mint(lp1, 1_000_000e18);
    }

    // ==================== Constructor Tests ====================

    function test_ConstructorSetsRolesAndPoolReserve() public view {
        assertEq(address(lpDistributor.roles()), address(roles));
        assertEq(address(lpDistributor.poolReserve()), address(poolReserve));
        assertEq(lpDistributor.latestEpochId(), 0);
        assertEq(lpDistributor.requestCount(), 0);
    }

    function test_ConstructorRevertsOnZeroRoles() public {
        vm.expectRevert(ZeroAddress.selector);
        new LPDistributor(address(0), address(poolReserve));
    }

    function test_ConstructorRevertsOnZeroPoolReserve() public {
        vm.expectRevert(ZeroAddress.selector);
        new LPDistributor(address(roles), address(0));
    }

    // ==================== Queue Distribution Tests ====================

    function test_QueueDistribution() public {
        // First, LP deposits to pool to have reserves available
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), INITIAL_LP_DEPOSIT);
        poolReserve.depositLP(INITIAL_LP_DEPOSIT);
        vm.stopPrank();

        uint256 epochId = 1;
        uint256 amount = 10_000e18;

        vm.prank(owner);
        
        vm.expectEmit(true, false, false, true);
        emit CCIPDistributionRequested(epochId, amount, DST_CHAIN_SELECTOR, receiver);
        
        vm.expectEmit(true, true, false, true);
        emit ReserveAllocatedToDistributor(amount, receiver);
        
        lpDistributor.queueDistribution(epochId, amount, DST_CHAIN_SELECTOR, receiver);

        // Verify state updates
        assertEq(lpDistributor.latestEpochId(), epochId);
        assertEq(lpDistributor.requestCount(), 1);
        assertTrue(lpDistributor.requestExists(epochId));

        // Verify stored request
        LPDistributor.DistributionRequest memory req = lpDistributor.getRequest(epochId);
        assertEq(req.epochId, epochId);
        assertEq(req.amount, amount);
        assertEq(req.dstChainSelector, DST_CHAIN_SELECTOR);
        assertEq(req.receiver, receiver);
        assertTrue(req.exists);
    }

    function test_QueueMultipleDistributions() public {
        // LP deposits first
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        vm.startPrank(owner);
        
        lpDistributor.queueDistribution(1, 5000e18, DST_CHAIN_SELECTOR, receiver);
        lpDistributor.queueDistribution(2, 3000e18, DST_CHAIN_SELECTOR, address(101));
        lpDistributor.queueDistribution(3, 2000e18, DST_CHAIN_SELECTOR, address(102));
        
        vm.stopPrank();

        assertEq(lpDistributor.latestEpochId(), 3);
        assertEq(lpDistributor.requestCount(), 3);
        assertTrue(lpDistributor.requestExists(1));
        assertTrue(lpDistributor.requestExists(2));
        assertTrue(lpDistributor.requestExists(3));
    }

    function test_QueueDistributionRevertsForNonOwner() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        lpDistributor.queueDistribution(1, 1000e18, DST_CHAIN_SELECTOR, receiver);
    }

    function test_QueueDistributionRevertsOnStaleEpoch() public {
        // LP deposits first
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        // Queue epoch 2 first
        vm.prank(owner);
        lpDistributor.queueDistribution(2, 1000e18, DST_CHAIN_SELECTOR, receiver);

        // Try to queue epoch 1 (should fail)
        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        lpDistributor.queueDistribution(1, 1000e18, DST_CHAIN_SELECTOR, receiver);
    }

    function test_QueueDistributionRevertsOnZeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(InvalidAmount.selector);
        lpDistributor.queueDistribution(1, 0, DST_CHAIN_SELECTOR, receiver);
    }

    function test_QueueDistributionRevertsOnZeroReceiver() public {
        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        lpDistributor.queueDistribution(1, 1000e18, DST_CHAIN_SELECTOR, address(0));
    }

    // ==================== Get Request Tests ====================

    function test_GetRequest() public {
        // LP deposits first
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        uint256 epochId = 1;
        uint256 amount = 5000e18;

        vm.prank(owner);
        lpDistributor.queueDistribution(epochId, amount, DST_CHAIN_SELECTOR, receiver);

        LPDistributor.DistributionRequest memory req = lpDistributor.getRequest(epochId);
        assertEq(req.epochId, epochId);
        assertEq(req.amount, amount);
        assertEq(req.dstChainSelector, DST_CHAIN_SELECTOR);
        assertEq(req.receiver, receiver);
        assertEq(req.timestamp, block.timestamp);
        assertTrue(req.exists);
    }

    function test_GetLatestRequest() public {
        // LP deposits first
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        vm.startPrank(owner);
        lpDistributor.queueDistribution(1, 1000e18, DST_CHAIN_SELECTOR, receiver);
        lpDistributor.queueDistribution(2, 2000e18, DST_CHAIN_SELECTOR, address(101));
        vm.stopPrank();

        LPDistributor.DistributionRequest memory req = lpDistributor.getLatestRequest();
        assertEq(req.epochId, 2);
        assertEq(req.amount, 2000e18);
    }

    function test_RequestExists() public {
        // LP deposits first
        vm.startPrank(lp1);
        asset.approve(address(poolReserve), 100_000e18);
        poolReserve.depositLP(100_000e18);
        vm.stopPrank();

        assertFalse(lpDistributor.requestExists(1));

        vm.prank(owner);
        lpDistributor.queueDistribution(1, 1000e18, DST_CHAIN_SELECTOR, receiver);

        assertTrue(lpDistributor.requestExists(1));
        assertFalse(lpDistributor.requestExists(2));
    }
}
