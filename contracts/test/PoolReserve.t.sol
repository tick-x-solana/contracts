// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PoolReserve} from "../src/PoolReserve.sol";
import {PoolReserveProxy} from "../src/PoolReserveProxy.sol";
import {ISignatureTransfer} from "../src/interfaces/ISignatureTransfer.sol";
import {TraderDeposited, TraderClaimed} from "../src/Events.sol";
import {
    Unauthorized,
    InvalidAmount,
    ZeroAddress,
    InsufficientBalance,
    InvalidSignature,
    SignatureExpired
} from "../src/Errors.sol";

contract MockERC20 is IERC20 {
    string public name = "Mock USDT";
    string public symbol = "mUSDT";
    uint8 public decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract PoolReserveV2 is PoolReserve {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract MockPermit2 {
    function permitTransferFrom(
        ISignatureTransfer.PermitTransferFrom calldata permit,
        ISignatureTransfer.SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata
    ) external {
        MockERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }
}

contract PoolReserveTest is Test {
    PoolReserve public poolReserve;
    PoolReserve public implementation;
    PoolReserveProxy public proxy;
    MockERC20 public asset;
    MockPermit2 public permit2;

    uint256 internal ownerKey = 0xA11CE;
    uint256 internal signerKey = 0xB0B;
    uint256 internal otherSignerKey = 0xCAFE;

    address public owner;
    address public claimSigner;
    address public trader = address(0x114);
    address public randomUser = address(0x199);

    uint256 constant INITIAL_MINT = 1_000_000e18;

    function setUp() public {
        owner = vm.addr(ownerKey);
        claimSigner = vm.addr(signerKey);
        asset = new MockERC20();
        permit2 = new MockPermit2();
        vm.etch(0x000000000022D473030F116dDEE9F6B43aC78BA3, address(permit2).code);

        implementation = new PoolReserve();
        proxy = new PoolReserveProxy(
            address(implementation),
            abi.encodeCall(PoolReserve.initialize, (owner, address(asset), claimSigner))
        );
        poolReserve = PoolReserve(address(proxy));

        asset.mint(trader, INITIAL_MINT);
        asset.mint(randomUser, INITIAL_MINT);
    }

    function test_InitializeSetsState() public view {
        assertEq(address(poolReserve.asset()), address(asset));
        assertEq(poolReserve.owner(), owner);
        assertEq(poolReserve.claimSigner(), claimSigner);
        assertEq(poolReserve.totalTraderDeposits(), 0);
    }

    function test_InitializeCannotRunTwice() public {
        vm.expectRevert(bytes4(keccak256("InvalidInitialization()")));
        poolReserve.initialize(owner, address(asset), claimSigner);
    }

    function test_ProxyConstructorRevertsOnZeroImplementation() public {
        vm.expectRevert();
        new PoolReserveProxy(address(0), abi.encodeCall(PoolReserve.initialize, (owner, address(asset), claimSigner)));
    }

    function test_DepositTraderTracksBalance() public {
        uint256 amount = 1000e18;

        vm.startPrank(trader);
        asset.approve(address(poolReserve), amount);

        vm.expectEmit(true, false, false, true);
        emit TraderDeposited(trader, amount);
        poolReserve.depositTrader(amount);
        vm.stopPrank();

        assertEq(poolReserve.traderBalanceOf(trader), amount);
        assertEq(poolReserve.totalTraderDeposits(), amount);
        assertEq(poolReserve.totalCollateral(), amount);
        assertEq(asset.balanceOf(trader), INITIAL_MINT - amount);
    }

    function test_DepositTraderRevertsOnZeroAmount() public {
        vm.prank(trader);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.depositTrader(0);
    }

    function test_DepositTraderWithPermit2TracksBalanceAndEmitsTraderDeposited() public {
        uint256 amount = 1000e18;
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({
                token: address(asset),
                amount: amount
            }),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        vm.startPrank(trader);
        asset.approve(address(poolReserve.PERMIT2()), amount);

        vm.expectEmit(true, false, false, true);
        emit TraderDeposited(trader, amount);
        poolReserve.depositTraderWithPermit2(amount, hex"1234", permit);
        vm.stopPrank();

        assertEq(poolReserve.traderBalanceOf(trader), amount);
        assertEq(poolReserve.totalTraderDeposits(), amount);
        assertEq(poolReserve.totalCollateral(), amount);
        assertEq(asset.balanceOf(trader), INITIAL_MINT - amount);
    }

    function test_DepositTraderWithPermit2RevertsOnWrongToken() public {
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({
                token: randomUser,
                amount: 1000e18
            }),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });

        vm.prank(trader);
        vm.expectRevert(InvalidAmount.selector);
        poolReserve.depositTraderWithPermit2(1000e18, hex"1234", permit);
    }

    function test_WithdrawTraderRequiresAdminSignature() public {
        uint256 depositAmount = 1000e18;
        uint256 withdrawAmount = 400e18;
        uint256 deadline = block.timestamp + 1 hours;

        _deposit(trader, depositAmount);
        bytes memory signature = _signClaim(signerKey, trader, withdrawAmount, deadline);

        uint256 balanceBefore = asset.balanceOf(trader);

        vm.prank(trader);
        vm.expectEmit(true, false, false, true);
        emit TraderClaimed(trader, withdrawAmount);
        poolReserve.withdrawTrader(withdrawAmount, deadline, signature);

        assertEq(asset.balanceOf(trader), balanceBefore + withdrawAmount);
        assertEq(poolReserve.traderBalanceOf(trader), depositAmount - withdrawAmount);
        assertEq(poolReserve.totalTraderDeposits(), depositAmount - withdrawAmount);
        assertEq(poolReserve.nonces(trader), 1);
    }

    function test_ClaimTraderUsesSameSignedWithdrawalPath() public {
        uint256 amount = 500e18;
        uint256 deadline = block.timestamp + 1 hours;

        _deposit(trader, amount);
        bytes memory signature = _signClaim(signerKey, trader, amount, deadline);

        vm.prank(trader);
        poolReserve.claimTrader(amount, deadline, signature);

        assertEq(poolReserve.traderBalanceOf(trader), 0);
        assertEq(poolReserve.totalCollateral(), 0);
    }

    function test_ClaimRejectsWrongSigner() public {
        uint256 amount = 500e18;
        uint256 deadline = block.timestamp + 1 hours;

        _deposit(trader, amount);
        bytes memory signature = _signClaim(otherSignerKey, trader, amount, deadline);

        vm.prank(trader);
        vm.expectRevert(InvalidSignature.selector);
        poolReserve.claimTrader(amount, deadline, signature);
    }

    function test_ClaimRejectsReplay() public {
        uint256 amount = 500e18;
        uint256 deadline = block.timestamp + 1 hours;

        _deposit(trader, amount * 2);
        bytes memory signature = _signClaim(signerKey, trader, amount, deadline);

        vm.prank(trader);
        poolReserve.claimTrader(amount, deadline, signature);

        vm.prank(trader);
        vm.expectRevert(InvalidSignature.selector);
        poolReserve.claimTrader(amount, deadline, signature);
    }

    function test_ClaimRejectsExpiredSignature() public {
        uint256 amount = 500e18;
        uint256 deadline = block.timestamp + 1 hours;

        _deposit(trader, amount);
        bytes memory signature = _signClaim(signerKey, trader, amount, deadline);

        vm.warp(deadline + 1);

        vm.prank(trader);
        vm.expectRevert(SignatureExpired.selector);
        poolReserve.claimTrader(amount, deadline, signature);
    }

    function test_ClaimRejectsInsufficientTraderBalance() public {
        uint256 amount = 500e18;
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = _signClaim(signerKey, trader, amount, deadline);

        vm.prank(trader);
        vm.expectRevert(InsufficientBalance.selector);
        poolReserve.claimTrader(amount, deadline, signature);
    }

    function test_OwnerCanUpdateClaimSigner() public {
        address newSigner = vm.addr(otherSignerKey);

        vm.prank(owner);
        poolReserve.setClaimSigner(newSigner);

        assertEq(poolReserve.claimSigner(), newSigner);
    }

    function test_NonOwnerCannotUpdateClaimSigner() public {
        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", randomUser));
        poolReserve.setClaimSigner(vm.addr(otherSignerKey));
    }

    function test_OwnerCanUpgradeImplementation() public {
        PoolReserveV2 v2 = new PoolReserveV2();

        vm.prank(owner);
        poolReserve.upgradeToAndCall(address(v2), "");

        assertEq(proxy.implementation(), address(v2));
        assertEq(PoolReserveV2(address(proxy)).version(), 2);
        assertEq(poolReserve.owner(), owner);
        assertEq(address(poolReserve.asset()), address(asset));
    }

    function test_NonOwnerCannotUpgradeImplementation() public {
        PoolReserveV2 v2 = new PoolReserveV2();

        vm.prank(randomUser);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", randomUser));
        poolReserve.upgradeToAndCall(address(v2), "");
    }

    function _deposit(address account, uint256 amount) internal {
        vm.startPrank(account);
        asset.approve(address(poolReserve), amount);
        poolReserve.depositTrader(amount);
        vm.stopPrank();
    }

    function _signClaim(
        uint256 privateKey,
        address account,
        uint256 amount,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 digest = poolReserve.getClaimDigest(
            account,
            amount,
            poolReserve.nonces(account),
            deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
