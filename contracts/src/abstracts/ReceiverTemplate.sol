// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165} from "../interfaces/IERC165.sol";
import {IReceiver} from "../interfaces/IReceiver.sol";

/// @title ReceiverTemplate - Abstract receiver with optional permission controls
/// @notice Provides flexible, updatable security checks for receiving workflow reports
/// @dev The forwarder address is required at construction time for security.
///      Additional permission fields can be configured using setter functions.
abstract contract ReceiverTemplate is IReceiver {
    // Required permission field at deployment, configurable after
    address private s_forwarderAddress; // If set, only this address can call onReport

    // Optional permission fields (all default to zero = disabled)
    address private s_expectedAuthor; // If set, only reports from this workflow owner are accepted
    bytes10 private s_expectedWorkflowName; // Only validated when s_expectedAuthor is also set
    bytes32 private s_expectedWorkflowId; // If set, only reports from this specific workflow ID are accepted

    // Ownership
    address private s_owner;

    // Hex character lookup table for bytes-to-hex conversion
    bytes private constant HEX_CHARS = "0123456789abcdef";

    // Custom errors
    error InvalidForwarderAddress();
    error InvalidSender(address sender, address expected);
    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error InvalidWorkflowId(bytes32 received, bytes32 expected);
    error WorkflowNameRequiresAuthorValidation();
    error OnlyOwner(address caller, address owner);

    // Events
    event ForwarderAddressUpdated(address indexed previousForwarder, address indexed newForwarder);
    event ExpectedAuthorUpdated(address indexed previousAuthor, address indexed newAuthor);
    event ExpectedWorkflowNameUpdated(bytes10 indexed previousName, bytes10 indexed newName);
    event ExpectedWorkflowIdUpdated(bytes32 indexed previousId, bytes32 indexed newId);
    event SecurityWarning(string message);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() virtual {
        if (msg.sender != s_owner) revert OnlyOwner(msg.sender, s_owner);
        _;
    }

    /// @notice Constructor sets msg.sender as the owner and configures the forwarder address
    /// @param _forwarderAddress The address of the Chainlink Forwarder contract (cannot be address(0))
    /// @dev The forwarder address is required for security - it ensures only verified reports are processed
    constructor(
        address _forwarderAddress
    ) {
        if (_forwarderAddress == address(0)) {
            revert InvalidForwarderAddress();
        }
        s_forwarderAddress = _forwarderAddress;
        s_owner = msg.sender;
        emit ForwarderAddressUpdated(address(0), _forwarderAddress);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Returns the configured forwarder address
    /// @return The forwarder address (address(0) if disabled)
    function getForwarderAddress() external view returns (address) {
        return s_forwarderAddress;
    }

    /// @notice Returns the expected workflow author address
    /// @return The expected author address (address(0) if not set)
    function getExpectedAuthor() external view returns (address) {
        return s_expectedAuthor;
    }

    /// @notice Returns the expected workflow name
    /// @return The expected workflow name (bytes10(0) if not set)
    function getExpectedWorkflowName() external view returns (bytes10) {
        return s_expectedWorkflowName;
    }

    /// @notice Returns the expected workflow ID
    /// @return The expected workflow ID (bytes32(0) if not set)
    function getExpectedWorkflowId() external view returns (bytes32) {
        return s_expectedWorkflowId;
    }

    /// @notice Returns the contract owner
    /// @return The owner address
    function owner() external view returns (address) {
        return s_owner;
    }

    /// @notice Transfers ownership to a new address
    /// @param newOwner The address to transfer ownership to
    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = s_owner;
        s_owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// @inheritdoc IReceiver
    /// @dev Performs optional validation checks based on which permission fields are set
    function onReport(
        bytes calldata metadata,
        bytes calldata report
    ) external override {
        // Security Check 1: Verify caller is the trusted Chainlink Forwarder (if configured)
        if (s_forwarderAddress != address(0) && msg.sender != s_forwarderAddress) {
            revert InvalidSender(msg.sender, s_forwarderAddress);
        }

        // Security Checks 2-4: Verify workflow identity - ID, owner, and/or name (if any are configured)
        if (s_expectedWorkflowId != bytes32(0) || s_expectedAuthor != address(0) || s_expectedWorkflowName != bytes10(0)) {
            (bytes32 workflowId, bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);

            if (s_expectedWorkflowId != bytes32(0) && workflowId != s_expectedWorkflowId) {
                revert InvalidWorkflowId(workflowId, s_expectedWorkflowId);
            }

            if (s_expectedAuthor != address(0) && workflowOwner != s_expectedAuthor) {
                revert InvalidAuthor(workflowOwner, s_expectedAuthor);
            }

            if (s_expectedWorkflowName != bytes10(0)) {
                if (s_expectedAuthor == address(0)) {
                    revert WorkflowNameRequiresAuthorValidation();
                }
                if (workflowName != s_expectedWorkflowName) {
                    revert InvalidWorkflowName(workflowName, s_expectedWorkflowName);
                }
            }
        }

        // Process the report - implementation specific
        _processReport(report);
    }

    /// @notice Updates the forwarder address
    /// @param newForwarder The new forwarder address
    /// @dev Only callable by contract owner
    function updateForwarderAddress(address newForwarder) external onlyOwner {
        address previousForwarder = s_forwarderAddress;
        s_forwarderAddress = newForwarder;
        emit ForwarderAddressUpdated(previousForwarder, newForwarder);
    }

    /// @notice Sets or updates the expected workflow author address
    /// @param newAuthor The expected author address (address(0) to disable)
    /// @dev Only callable by contract owner. When set, only reports from this owner are accepted.
    function setExpectedAuthor(address newAuthor) external onlyOwner {
        address previousAuthor = s_expectedAuthor;
        s_expectedAuthor = newAuthor;
        emit ExpectedAuthorUpdated(previousAuthor, newAuthor);

        if (newAuthor == address(0) && s_expectedWorkflowName != bytes10(0)) {
            emit SecurityWarning("Workflow name validation disabled because author validation is disabled");
        }
    }

    /// @notice Sets or updates the expected workflow name
    /// @param newName The expected workflow name (bytes10(0) to disable)
    /// @dev Only callable by contract owner. Requires author validation to be enabled.
    function setExpectedWorkflowName(bytes10 newName) external onlyOwner {
        if (newName != bytes10(0) && s_expectedAuthor == address(0)) {
            revert WorkflowNameRequiresAuthorValidation();
        }
        bytes10 previousName = s_expectedWorkflowName;
        s_expectedWorkflowName = newName;
        emit ExpectedWorkflowNameUpdated(previousName, newName);
    }

    /// @notice Sets or updates the expected workflow ID
    /// @param newId The expected workflow ID (bytes32(0) to disable)
    /// @dev Only callable by contract owner. When set, only reports from this workflow ID are accepted.
    function setExpectedWorkflowId(bytes32 newId) external onlyOwner {
        bytes32 previousId = s_expectedWorkflowId;
        s_expectedWorkflowId = newId;
        emit ExpectedWorkflowIdUpdated(previousId, newId);
    }

    /// @notice Decodes metadata into workflow identification fields
    /// @param metadata The metadata bytes to decode
    /// @return workflowId The unique identifier for the workflow
    /// @return workflowName The human-readable name of the workflow
    /// @return workflowOwner The address of the workflow owner
    /// @dev Metadata is encoded as: bytes32 workflowId || bytes10 workflowName || address workflowOwner
    function _decodeMetadata(bytes calldata metadata)
        internal
        pure
        returns (bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    {
        require(metadata.length >= 42, "Invalid metadata length");

        assembly {
            // Load workflowId (first 32 bytes)
            workflowId := calldataload(metadata.offset)

            // Load workflowName (next 10 bytes)
            // Shift right by 22 bytes (176 bits) to get the 10 bytes in the low bits
            let nameWord := calldataload(add(metadata.offset, 32))
            workflowName := shl(176, shr(176, nameWord))

            // Load workflowOwner (last 20 bytes)
            workflowOwner := shr(96, calldataload(add(metadata.offset, 42)))
        }
    }

    /// @notice Converts bytes to hex string (useful for logging/debugging)
    /// @param data The bytes to convert
    /// @return The hex string representation
    function _bytesToHex(bytes memory data) internal pure returns (string memory) {
        bytes memory hexString = new bytes(2 + data.length * 2);
        hexString[0] = "0";
        hexString[1] = "x";

        for (uint256 i = 0; i < data.length; i++) {
            uint8 byteValue = uint8(data[i]);
            hexString[2 + i * 2] = HEX_CHARS[byteValue >> 4];
            hexString[3 + i * 2] = HEX_CHARS[byteValue & 0x0f];
        }

        return string(hexString);
    }

    /// @notice Implementation-specific report processing logic
    /// @param report The raw report data to process
    /// @dev Must be implemented by inheriting contracts
    function _processReport(bytes calldata report) internal virtual;

    /// @notice ERC165 interface detection
    /// @param interfaceId The interface identifier
    /// @return true if the contract implements the interface
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
