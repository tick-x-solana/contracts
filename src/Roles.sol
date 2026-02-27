// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Unauthorized, InvalidRoleAddress, ZeroAddress} from "./Errors.sol";

/**
 * @title Roles
 * @notice Minimal role-based access control for hackathon PoC
 * @dev Uses explicit role addresses instead of full RBAC for gas/simplicity
 */
contract Roles {
    // Role addresses
    address public owner;
    address public reporter;
    address public settler;
    address public strategist;
    address public distributor;

    // Role update events
    event RoleUpdated(string indexed role, address indexed newAddress);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyReporter() {
        if (msg.sender != reporter) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlySettler() {
        if (msg.sender != settler) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyStrategist() {
        if (msg.sender != strategist) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyDistributor() {
        if (msg.sender != distributor) revert Unauthorized(msg.sender);
        _;
    }

    constructor(
        address _owner,
        address _reporter,
        address _settler,
        address _strategist,
        address _distributor
    ) {
        if (_owner == address(0)) revert ZeroAddress();
        
        owner = _owner;
        reporter = _reporter;
        settler = _settler;
        strategist = _strategist;
        distributor = _distributor;
    }

    /**
     * @notice Update the reporter address
     * @param _reporter New reporter address
     */
    function setReporter(address _reporter) external onlyOwner {
        if (_reporter == address(0)) revert ZeroAddress();
        reporter = _reporter;
        emit RoleUpdated("reporter", _reporter);
    }

    /**
     * @notice Update the settler address
     * @param _settler New settler address
     */
    function setSettler(address _settler) external onlyOwner {
        if (_settler == address(0)) revert ZeroAddress();
        settler = _settler;
        emit RoleUpdated("settler", _settler);
    }

    /**
     * @notice Update the strategist address
     * @param _strategist New strategist address
     */
    function setStrategist(address _strategist) external onlyOwner {
        if (_strategist == address(0)) revert ZeroAddress();
        strategist = _strategist;
        emit RoleUpdated("strategist", _strategist);
    }

    /**
     * @notice Update the distributor address
     * @param _distributor New distributor address
     */
    function setDistributor(address _distributor) external onlyOwner {
        if (_distributor == address(0)) revert ZeroAddress();
        distributor = _distributor;
        emit RoleUpdated("distributor", _distributor);
    }

    /**
     * @notice Transfer ownership to a new address
     * @param _newOwner New owner address
     */
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        owner = _newOwner;
        emit RoleUpdated("owner", _newOwner);
    }
}
