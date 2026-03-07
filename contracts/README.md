# Tapl × Chainlink - Smart Contracts

Smart contracts for the Tapl prediction gaming platform with Chainlink integration.

## Overview

This is a **BTC prediction trading game** where users tap grid cells to predict BTC price movements in 5-second windows. The system uses Chainlink Data Streams for price feeds and Chainlink CRE (Runtime Environment) for autonomous workflows.

## ⚠️ IMPORTANT: CRE Contract Fix Required

**Current Issue:** The deployed contracts cannot receive reports from CRE workflows because they don't implement the required `IReceiver` interface.

**Fix Required:** See `../specs/CRE-CONTRACT-FIX-PLAN.md` for detailed instructions.

**Quick Summary:**
- CRE workflows submit signed reports to a Chainlink `KeystoneForwarder` contract
- Forwarder calls `onReport()` on consumer contracts
- Contracts must inherit `ReceiverTemplate` and implement `IReceiver` interface
- All contracts need constructor update with forwarder address

**Official Docs:** https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts

## Architecture

| Contract | Purpose |
|----------|---------|
| **PriceIntegrity.sol** | 15-minute batch price comparisons with pass/fail flags |
| **PoolReserve.sol** | LP share accounting, trader balances, solvency reporting |
| **Settlement.sol** | Batch settlement commitments and withdrawable updates |
| **LPDistributor.sol** | LP distribution signaling (CCIP mock for PoC) |
| **StrategyManager.sol** | Volatility regime parameter management |
| **Roles.sol** | Role-based access control |

## Tech Stack

- **Foundry** - Ethereum development toolkit
- **Solidity 0.8.19**
- **Chainlink CRE** - Runtime Environment (mocked for PoC)
- **Target Network** - Base Sepolia

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- RPC URL (e.g., from Alchemy, Infura, or public Base Sepolia)

### Install Dependencies

```bash
forge install
```

### Build

```bash
forge build
```

### Test

```bash
forge test
```

Run with verbose output:
```bash
forge test -vv
```

### Format

```bash
forge fmt
```

## Deployment

### 1. Configure Environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `RPC_URL` - Your RPC endpoint
- `PRIVATE_KEY` - Deployer private key
- `OWNER_ADDRESS` - Contract owner address
- `REPORTER_ADDRESS` - Price integrity reporter
- `SETTLER_ADDRESS` - Settlement authority
- `STRATEGIST_ADDRESS` - Strategy manager
- `DISTRIBUTOR_ADDRESS` - LP distributor
- `ASSET_ADDRESS` - USDT or mock token address

### 2. Deploy Contracts

```bash
source .env
forge script script/DeployHackathon.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Save the deployed contract addresses to your `.env` file.

### 3. Seed Demo Data

Update `.env` with deployed addresses, then run:

```bash
source .env
forge script script/SeedDemoData.s.sol --rpc-url $RPC_URL --broadcast
```

## Contract Interactions

### Price Integrity (Reporter only)

```bash
# Submit batch comparison
cast send $PRICE_INTEGRITY_ADDRESS "submitBatchComparison(...)" \
  --rpc-url $RPC_URL --private-key $REPORTER_PRIVATE_KEY
```

### Pool Reserve

```bash
# LP Deposit
cast send $POOL_RESERVE_ADDRESS "depositLP(uint256)" 1000000000000000000000 \
  --rpc-url $RPC_URL --private-key $LP_PRIVATE_KEY

# Trader Deposit
cast send $POOL_RESERVE_ADDRESS "depositTrader(uint256)" 10000000000000000000 \
  --rpc-url $RPC_URL --private-key $TRADER_PRIVATE_KEY
```

### Settlement (Owner only)

```bash
# Commit settlement batch
cast send $SETTLEMENT_ADDRESS "commitSettlementBatch(...)" \
  --rpc-url $RPC_URL --private-key $OWNER_PRIVATE_KEY
```

## Project Structure

```
├── src/
│   ├── Errors.sol              # Shared custom errors
│   ├── Events.sol              # Shared events
│   ├── Roles.sol               # Access control
│   ├── PriceIntegrity.sol      # Price integrity reporting
│   ├── PoolReserve.sol         # Vault and liquidity
│   ├── Settlement.sol          # Settlement logic
│   ├── LPDistributor.sol       # LP distribution
│   └── StrategyManager.sol     # Strategy parameters
├── test/
│   ├── AccessControl.t.sol
│   ├── PriceIntegrity.t.sol
│   ├── PoolReserve.t.sol
│   ├── Settlement.t.sol
│   ├── SettlementPoolReserve.integration.t.sol
│   ├── LPDistributor.t.sol
│   └── StrategyManager.t.sol
├── script/
│   ├── DeployHackathon.s.sol   # Deployment script
│   └── SeedDemoData.s.sol      # Demo data script
└── specs/
    └── smart-contract-vertical-slides.md  # Implementation spec
```

## Test Coverage

```
✅ 117 tests passing
- AccessControl: 12 tests
- PriceIntegrity: 18 tests
- PoolReserve: 35 tests
- Settlement: 23 tests
- Settlement Integration: 4 tests
- LPDistributor: 12 tests
- StrategyManager: 13 tests
```

## PoC Limitations

- **No IReceiver interface** (contracts cannot receive CRE reports yet - see fix plan)
- No real CCIP integration (event-only mock)
- No on-chain candle verification (trusted CRE reporter)
- No pause functionality
- No upgradeability
- Mock ERC20 token for testing

## License

MIT

## References

- [Chainlink CRE Docs](https://docs.chain.link/cre)
- [Chainlink Data Streams](https://docs.chain.link/data-streams)
- [Euphoria Finance](https://euphoria.finance/) - UI reference
