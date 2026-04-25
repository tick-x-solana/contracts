// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {
    Unauthorized,
    InvalidAmount,
    ZeroAddress,
    InsufficientBalance,
    InsufficientCollateral,
    InvalidSignature,
    SignatureExpired
} from "./Errors.sol";
import {TraderDeposited, TraderClaimed} from "./Events.sol";
import {ISignatureTransfer} from "./interfaces/ISignatureTransfer.sol";

/// @title PoolReserve
/// @notice UUPS-upgradeable ERC20 reserve focused on trader deposits and admin-signed withdrawals.
/// @dev No LP accounting, CRE receiver, or solvency logic.
contract PoolReserve is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "PoolReserveClaim(address trader,uint256 amount,uint256 nonce,uint256 deadline,address verifyingContract,uint256 chainId)"
    );

    ISignatureTransfer public constant PERMIT2 =
        ISignatureTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    IERC20 public asset;
    address public claimSigner;
    bool private reentrancyLock;

    uint256 public totalTraderDeposits;
    uint256 public totalLPShares;
    uint256 public latestSolvencyEpochId;
    mapping(address => uint256) public traderBalanceOf;
    mapping(address => uint256) public lpSharesOf;
    mapping(address => uint256) public nonces;

    struct SolvencyReport {
        uint256 epochId;
        uint256 poolBalance;
        uint256 totalLiability;
        uint256 utilizationBps;
        uint256 maxSingleBetExposure;
        uint256 timestamp;
        uint256 solvencyRatio;
    }

    event PoolReserveInitialized(address indexed owner, address indexed asset, address indexed claimSigner);
    event ClaimSignerUpdated(address indexed previousSigner, address indexed newSigner);

    modifier nonReentrant() {
        if (reentrancyLock) revert Unauthorized(msg.sender);
        reentrancyLock = true;
        _;
        reentrancyLock = false;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize proxy storage.
    /// @param _owner Owner allowed to update signer and authorize upgrades.
    /// @param _asset ERC20 reserve asset.
    /// @param _claimSigner Admin signer authorizing trader claims.
    function initialize(address _owner, address _asset, address _claimSigner) external initializer {
        if (_asset == address(0)) revert ZeroAddress();
        if (_claimSigner == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);

        asset = IERC20(_asset);
        claimSigner = _claimSigner;

        emit PoolReserveInitialized(_owner, _asset, _claimSigner);
    }

    /// @notice Deposit trader collateral into the reserve.
    /// @param amount Amount of assets to deposit.
    function depositTrader(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        bool success = asset.transferFrom(msg.sender, address(this), amount);
        if (!success) revert InvalidAmount();

        _recordTraderDeposit(msg.sender, amount);
    }

    /// @notice Deposit trader collateral using Uniswap Permit2 SignatureTransfer.
    /// @param amount Amount of assets to pull through Permit2.
    /// @param permit2Signature Trader's Permit2 signature.
    /// @param permit Permit2 transfer authorization.
    function depositTraderWithPermit2(
        uint256 amount,
        bytes calldata permit2Signature,
        ISignatureTransfer.PermitTransferFrom calldata permit
    ) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (permit.permitted.token != address(asset)) revert InvalidAmount();

        ISignatureTransfer.SignatureTransferDetails memory transferDetails =
            ISignatureTransfer.SignatureTransferDetails({
                to: address(this),
                requestedAmount: amount
            });

        PERMIT2.permitTransferFrom(permit, transferDetails, msg.sender, permit2Signature);

        _recordTraderDeposit(msg.sender, amount);
    }

    function _recordTraderDeposit(address trader, uint256 amount) internal {
        traderBalanceOf[trader] += amount;
        totalTraderDeposits += amount;

        emit TraderDeposited(trader, amount);
    }

    /// @notice Withdraw trader collateral with an admin signature.
    /// @param amount Amount of assets to withdraw.
    /// @param deadline Last valid timestamp for the signature.
    /// @param adminSignature Signature from claimSigner over this claim.
    function withdrawTrader(
        uint256 amount,
        uint256 deadline,
        bytes calldata adminSignature
    ) public nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (traderBalanceOf[msg.sender] < amount) revert InsufficientBalance();
        if (asset.balanceOf(address(this)) < amount) revert InsufficientCollateral();

        uint256 nonce = nonces[msg.sender];
        bytes32 digest = getClaimDigest(msg.sender, amount, nonce, deadline);
        if (_recoverSigner(digest, adminSignature) != claimSigner) revert InvalidSignature();

        nonces[msg.sender] = nonce + 1;
        traderBalanceOf[msg.sender] -= amount;
        totalTraderDeposits -= amount;

        bool success = asset.transfer(msg.sender, amount);
        if (!success) revert InvalidAmount();

        emit TraderClaimed(msg.sender, amount);
    }

    /// @notice Claim is the signed trader withdrawal path.
    function claimTrader(
        uint256 amount,
        uint256 deadline,
        bytes calldata adminSignature
    ) external {
        withdrawTrader(amount, deadline, adminSignature);
    }

    function claimTrader(uint256) external pure {
        revert InvalidSignature();
    }

    function setClaimSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address previousSigner = claimSigner;
        claimSigner = newSigner;
        emit ClaimSignerUpdated(previousSigner, newSigner);
    }

    function totalCollateral() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }

    // ==================== Disabled Legacy Surface ====================
    // These selectors are kept only so older scripts/tests compile while the
    // reserve is trader-only. They intentionally do not implement LP, CRE, or
    // solvency behavior.

    function depositLP(uint256) external pure {
        revert InvalidAmount();
    }

    function withdrawLP(uint256) external pure {
        revert InvalidAmount();
    }

    function reportSolvency(uint256, uint256, uint256, uint256, uint256) external pure {
        revert InvalidAmount();
    }

    function allocateReserveToLPDistributor(uint256, address) external pure {
        revert InvalidAmount();
    }

    function getSolvencyReport(uint256) external pure returns (SolvencyReport memory) {
        return SolvencyReport(0, 0, 0, 0, 0, 0, 0);
    }

    function getLatestSolvencyReport() external pure returns (SolvencyReport memory) {
        return SolvencyReport(0, 0, 0, 0, 0, 0, 0);
    }

    function lpValueOf(address) external pure returns (uint256) {
        return 0;
    }

    function previewDepositLP(uint256) external pure returns (uint256) {
        return 0;
    }

    function previewWithdrawLP(uint256) external pure returns (uint256) {
        return 0;
    }

    function onReport(bytes calldata, bytes calldata) external pure {
        revert InvalidAmount();
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }

    function getForwarderAddress() external pure returns (address) {
        return address(0);
    }

    function getClaimDigest(
        address trader,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encode(
                        CLAIM_TYPEHASH,
                        trader,
                        amount,
                        nonce,
                        deadline,
                        address(this),
                        block.chainid
                    )
                )
            )
        );
    }

    /// @notice UUPS upgrade authorization: only PoolReserve owner can upgrade.
    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

    uint256[44] private __gap;
}
