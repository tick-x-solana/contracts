// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {StrategyManager} from "../src/StrategyManager.sol";
import {Roles} from "../src/Roles.sol";
import {Unauthorized, InvalidAmount, ZeroAddress} from "../src/Errors.sol";
import {VolatilityRegimeChanged} from "../src/Events.sol";

contract StrategyManagerTest is Test {
    StrategyManager public strategyManager;
    Roles public roles;
    
    address public owner = address(1);
    address public strategist = address(2);
    address public randomUser = address(99);

    function setUp() public {
        // Deploy roles with strategist
        vm.prank(owner);
        roles = new Roles(owner, address(0), address(0), strategist, address(0));
        
        // Deploy StrategyManager
        strategyManager = new StrategyManager(address(roles));
    }

    // ==================== Constructor Tests ====================

    function test_ConstructorSetsRoles() public view {
        assertEq(address(strategyManager.roles()), address(roles));
        assertEq(strategyManager.latestRegimeId(), 0);
    }

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        new StrategyManager(address(0));
    }

    // ==================== Set Volatility Regime Tests ====================

    function test_SetVolatilityRegime() public {
        uint256 regimeId = 1;
        uint256 spreadBps = 100; // 1%
        uint256 maxMult = 100; // 100x

        vm.prank(strategist);
        
        vm.expectEmit(true, false, false, true);
        emit VolatilityRegimeChanged(regimeId, spreadBps, maxMult);
        
        strategyManager.setVolatilityRegime(regimeId, spreadBps, maxMult);

        // Verify state
        assertEq(strategyManager.latestRegimeId(), regimeId);
        assertTrue(strategyManager.regimeExists(regimeId));

        // Verify stored regime
        StrategyManager.VolatilityRegime memory regime = strategyManager.getRegime(regimeId);
        assertEq(regime.regimeId, regimeId);
        assertEq(regime.fortressSpreadBps, spreadBps);
        assertEq(regime.maxMultiplier, maxMult);
        assertEq(regime.timestamp, block.timestamp);
        assertTrue(regime.exists);

        // Verify current regime
        StrategyManager.VolatilityRegime memory current = strategyManager.getCurrentRegime();
        assertEq(current.regimeId, regimeId);
        assertEq(current.fortressSpreadBps, spreadBps);
        assertEq(current.maxMultiplier, maxMult);
    }

    function test_SetMultipleRegimes() public {
        vm.startPrank(strategist);
        
        strategyManager.setVolatilityRegime(1, 100, 100); // Low vol
        strategyManager.setVolatilityRegime(2, 200, 50);  // Medium vol
        strategyManager.setVolatilityRegime(3, 500, 20);  // High vol
        
        vm.stopPrank();

        assertEq(strategyManager.latestRegimeId(), 3);
        
        // Current should be the latest
        StrategyManager.VolatilityRegime memory current = strategyManager.getCurrentRegime();
        assertEq(current.regimeId, 3);
        assertEq(current.fortressSpreadBps, 500);
        assertEq(current.maxMultiplier, 20);

        // All should exist
        assertTrue(strategyManager.regimeExists(1));
        assertTrue(strategyManager.regimeExists(2));
        assertTrue(strategyManager.regimeExists(3));
    }

    function test_SetRegimeRevertsForNonStrategist() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, randomUser));
        strategyManager.setVolatilityRegime(1, 100, 100);
    }

    function test_SetRegimeRevertsOnStaleRegimeId() public {
        // Set regime 2 first
        vm.prank(strategist);
        strategyManager.setVolatilityRegime(2, 100, 100);

        // Try to set regime 1 (should fail)
        vm.prank(strategist);
        vm.expectRevert(InvalidAmount.selector);
        strategyManager.setVolatilityRegime(1, 200, 50);
    }

    function test_SetRegimeRevertsOnDuplicateRegimeId() public {
        // Set regime 1
        vm.prank(strategist);
        strategyManager.setVolatilityRegime(1, 100, 100);

        // Try to set regime 1 again (should fail)
        vm.prank(strategist);
        vm.expectRevert(InvalidAmount.selector);
        strategyManager.setVolatilityRegime(1, 200, 50);
    }

    function test_SetRegimeRevertsOnZeroSpread() public {
        vm.prank(strategist);
        vm.expectRevert(InvalidAmount.selector);
        strategyManager.setVolatilityRegime(1, 0, 100);
    }

    function test_SetRegimeRevertsOnZeroMultiplier() public {
        vm.prank(strategist);
        vm.expectRevert(InvalidAmount.selector);
        strategyManager.setVolatilityRegime(1, 100, 0);
    }

    // ==================== Query Tests ====================

    function test_GetRegime() public {
        vm.prank(strategist);
        strategyManager.setVolatilityRegime(1, 150, 75);

        StrategyManager.VolatilityRegime memory regime = strategyManager.getRegime(1);
        assertEq(regime.regimeId, 1);
        assertEq(regime.fortressSpreadBps, 150);
        assertEq(regime.maxMultiplier, 75);
    }

    function test_GetCurrentRegime() public {
        vm.startPrank(strategist);
        strategyManager.setVolatilityRegime(1, 100, 100);
        strategyManager.setVolatilityRegime(2, 200, 50);
        vm.stopPrank();

        StrategyManager.VolatilityRegime memory current = strategyManager.getCurrentRegime();
        assertEq(current.regimeId, 2);
        assertEq(current.fortressSpreadBps, 200);
        assertEq(current.maxMultiplier, 50);
    }

    function test_RegimeExists() public {
        assertFalse(strategyManager.regimeExists(1));

        vm.prank(strategist);
        strategyManager.setVolatilityRegime(1, 100, 100);

        assertTrue(strategyManager.regimeExists(1));
        assertFalse(strategyManager.regimeExists(2));
    }

    function test_GetNonExistentRegime() public view {
        StrategyManager.VolatilityRegime memory regime = strategyManager.getRegime(999);
        assertEq(regime.regimeId, 0);
        assertFalse(regime.exists);
    }
}
