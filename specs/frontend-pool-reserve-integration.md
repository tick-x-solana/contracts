# Frontend Spec: PoolReserve Deposit/Withdraw (LP + Trader)

## Purpose

Guide frontend implementation for calling `PoolReserve.sol` deposit/withdraw functions for:
- LP users
- Trader users

Contract source:
- `contracts/src/PoolReserve.sol`

## Contracts and Core Methods

## PoolReserve (write)

- `depositLP(uint256 amount)`
- `withdrawLP(uint256 shares)`
- `depositTrader(uint256 amount)`
- `claimTrader(uint256 amount)`

## PoolReserve (read)

- `asset() -> address`
- `totalLPShares() -> uint256`
- `lpSharesOf(address) -> uint256`
- `totalCollateral() -> uint256`
- `lpValueOf(address) -> uint256`
- `previewDepositLP(uint256 amount) -> uint256 shares`
- `previewWithdrawLP(uint256 shares) -> uint256 amount`

## ERC20 asset (read/write)

- `decimals() -> uint8`
- `balanceOf(address) -> uint256`
- `allowance(address owner, address spender) -> uint256`
- `approve(address spender, uint256 amount)`

## Required Events To Watch

- `LPDeposited(address lp, uint256 amount, uint256 sharesMinted)`
- `LPWithdrawn(address lp, uint256 sharesBurned, uint256 amountReturned)`
- `TraderDeposited(address trader, uint256 amount)`
- `TraderClaimed(address trader, uint256 amount)`

## Amount and Unit Rules

- Always convert UI decimal input using token decimals (`parseUnits`).
- Always render chain values with token decimals (`formatUnits`).
- Never send floating values onchain.
- Reject `0` amount in UI before wallet prompt.

## LP Flow

## LP Deposit

1. Read `asset()` from `PoolReserve`.
2. Read token `decimals`, user `balanceOf`, and `allowance`.
3. If `allowance < amount`, send `approve(poolReserve, amount)` first.
4. Optionally quote shares using `previewDepositLP(amount)`.
5. Send `depositLP(amount)`.
6. Confirm by tx receipt and `LPDeposited` event.
7. Refresh:
   - `lpSharesOf(user)`
   - `totalLPShares()`
   - `lpValueOf(user)`
   - `totalCollateral()`

## LP Withdraw

1. Read `lpSharesOf(user)`.
2. User input should be **shares** (recommended), because contract withdraws by shares.
3. Quote returned asset using `previewWithdrawLP(shares)`.
4. Validate `shares <= lpSharesOf(user)`.
5. Send `withdrawLP(shares)`.
6. Confirm by tx receipt and `LPWithdrawn` event.
7. Refresh same LP read model fields.

## Trader Flow

## Trader Deposit

1. Read `asset()` from `PoolReserve`.
2. Read `decimals`, `balanceOf(user)`, `allowance(user, poolReserve)`.
3. If needed, send `approve(poolReserve, amount)`.
4. Send `depositTrader(amount)`.
5. Confirm by tx receipt and `TraderDeposited` event.
6. Refresh wallet token balance and `totalCollateral()`.

## Trader Withdraw

1. User enters withdraw amount.
2. Send `claimTrader(amount)`.
3. Confirm by tx receipt and `TraderClaimed` event.
4. Refresh wallet token balance and `totalCollateral()`.

## Important PoC Behavior (must reflect in UI copy)

- Current `PoolReserve` implementation is demo-minimal for trader accounting:
  - `depositTrader` does not persist per-trader balances.
  - `claimTrader` does not check trader-specific withdrawable/balance in storage.
  - Success depends on vault token balance and ERC20 transfer success.
- Frontend must show this as PoC behavior and enforce additional UI-level safety checks where possible.

## Error Handling Map

- `InvalidAmount()`
  - zero amount
  - failed token transfer (`transfer`/`transferFrom` returned false)
  - invalid inputs in some internal checks
- `InsufficientShares()`
  - LP withdraw shares exceed `lpSharesOf(user)`

Frontend handling:
- Pre-validate inputs before sending tx.
- Show revert reason if available; otherwise show user-safe fallback message.
- Keep tx hash and receipt status in UI for retry/debug.

## UI/UX Requirements

- Disable submit button while tx pending.
- Show 2-step state when approval is needed:
  - `Approve`
  - `Deposit`
- After success, refresh read model from chain, not local optimistic math only.
- For LP withdraw, default input mode to shares and show quoted token output.

## Minimal Integration Checklist

- [ ] Read token decimals dynamically from `asset`.
- [ ] Implement approval checks for LP/trader deposits.
- [ ] Implement LP deposit flow with `previewDepositLP`.
- [ ] Implement LP withdraw flow in shares with `previewWithdrawLP`.
- [ ] Implement trader deposit and trader withdraw (`claimTrader`) flows.
- [ ] Subscribe/index required events for confirmation and activity history.
- [ ] Add PoC disclaimer for trader accounting behavior.
