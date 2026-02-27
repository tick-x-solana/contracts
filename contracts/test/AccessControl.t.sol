// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Roles} from "../src/Roles.sol";
import {Unauthorized, ZeroAddress} from "../src/Errors.sol";

contract AccessControlTest is Test {
    Roles public roles;
    
    address public owner = address(1);
    address public reporter = address(2);
    address public settler = address(3);
    address public strategist = address(4);
    address public distributor = address(5);
    
    address public randomUser = address(99);

    function setUp() public {
        vm.prank(owner);
        roles = new Roles(owner, reporter, settler, strategist, distributor);
    }

    // ==================== Constructor Tests ====================

    function test_ConstructorSetsRolesCorrectly() public view {
        assertEq(roles.owner(), owner);
        assertEq(roles.reporter(), reporter);
        assertEq(roles.settler(), settler);
        assertEq(roles.strategist(), strategist);
        assertEq(roles.distributor(), distributor);
    }

    function test_ConstructorRevertsOnZeroOwner() public {
        vm.expectRevert(ZeroAddress.selector);
        new Roles(address(0), reporter, settler, strategist, distributor);
    }

    // ==================== Role Modifiers ====================

    function test_OwnerCanCallOwnerFunctions() public {
        vm.prank(owner);
        roles.setReporter(address(100));
        assertEq(roles.reporter(), address(100));
    }

    function test_NonOwnerCannotCallOwnerFunctions() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        roles.setReporter(address(100));
    }

    // ==================== Role Update Tests ====================

    function test_SetReporter() public {
        address newReporter = address(200);
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit Roles.RoleUpdated("reporter", newReporter);
        roles.setReporter(newReporter);
        
        assertEq(roles.reporter(), newReporter);
    }

    function test_SetSettler() public {
        address newSettler = address(201);
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit Roles.RoleUpdated("settler", newSettler);
        roles.setSettler(newSettler);
        
        assertEq(roles.settler(), newSettler);
    }

    function test_SetStrategist() public {
        address newStrategist = address(202);
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit Roles.RoleUpdated("strategist", newStrategist);
        roles.setStrategist(newStrategist);
        
        assertEq(roles.strategist(), newStrategist);
    }

    function test_SetDistributor() public {
        address newDistributor = address(203);
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit Roles.RoleUpdated("distributor", newDistributor);
        roles.setDistributor(newDistributor);
        
        assertEq(roles.distributor(), newDistributor);
    }

    function test_SetReporterRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        roles.setReporter(address(0));
    }

    // ==================== Ownership Transfer ====================

    function test_TransferOwnership() public {
        address newOwner = address(300);
        
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit Roles.RoleUpdated("owner", newOwner);
        roles.transferOwnership(newOwner);
        
        assertEq(roles.owner(), newOwner);
    }

    function test_TransferOwnershipRevertsOnZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(ZeroAddress.selector);
        roles.transferOwnership(address(0));
    }

    function test_OldOwnerCannotCallAfterTransfer() public {
        address newOwner = address(300);
        
        vm.prank(owner);
        roles.transferOwnership(newOwner);
        
        // Old owner should now be unauthorized
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, owner));
        roles.setReporter(address(100));
    }
}
