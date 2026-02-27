# Tap.fun CRE Workflows

Chainlink Runtime Environment (CRE) workflows for the Tap.fun prediction gaming platform.

## 📚 Documentation

- **[AGENTS.md](./AGENTS.md)** - Comprehensive development guide with best practices, common pitfalls, and troubleshooting
- **[workflow-template/](./workflow-template/)** - Template for creating new workflows

## Overview

This project implements 5 CRE workflows that interact with the Tap.fun smart contracts:

| Workflow | Trigger | Purpose | Status |
|----------|---------|---------|--------|
| **Price Integrity** | 15m cron | OHLC candle comparison with pass/fail reporting | ✅ Complete |
| **Settlement** | 15m cron | Batch settlement commitment | ⏳ Pending |
| **Pool Solvency PoR** | Daily cron | Proof-of-reserve solvency reporting | ⏳ Pending |
| **LP Distribution** | Daily cron | LP reward distribution queueing | ⏳ Pending |
| **Strategy Rebalance** | HTTP trigger | Volatility regime parameter updates | ⏳ Pending |

## Project Structure

```
cre/
├── price-integrity/          # ✅ Workflow 1: Price Integrity
│   ├── main.ts               # Entry point
│   ├── workflow.yaml         # CRE workflow configuration
│   ├── config.json           # Runtime config
│   ├── types.ts              # Local types
│   └── lib/                  # Local utilities
├── workflow-template/        # 📋 Template for new workflows
│   ├── main.ts
│   ├── workflow.yaml
│   ├── config.json
│   ├── types.ts
│   └── lib/
├── src/                      # 📚 Reference implementations (templates)
│   └── lib/
├── test/
│   └── price-integrity.test.ts
├── package.json
├── tsconfig.json
├── project.yaml              # CRE project settings
├── secrets.yaml              # Secrets template
├── AGENTS.md                 # 📖 Development guide
└── README.md
```

### ⚠️ CRITICAL: File Co-location

The CRE compiler **CANNOT** resolve `../` parent directory imports. All workflow files must be co-located within the workflow directory (e.g., `price-integrity/`). See [AGENTS.md](./AGENTS.md) for details.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- CRE CLI - `npm install -g @chainlink/cre-cli` (or use npx)

### Install Dependencies

```bash
cd cre
bun install
```

### Build

```bash
bun run build
```

### Test

```bash
bun test
```

### Run Simulation

```bash
# Local simulation
cre workflow simulate price-integrity --target local-simulation
```

## Creating New Workflows

```bash
# 1. Copy the template
cp -r workflow-template settlement

# 2. Update workflow.yaml - change workflow-name
# 3. Update config.json - add your contract addresses
# 4. Implement logic in main.ts
# 5. Copy needed utilities from price-integrity/lib/

# 6. Run simulation
cre workflow simulate settlement --target local-simulation
```

See **[AGENTS.md](./AGENTS.md)** for detailed development guide.

## Configuration

### Environment Variables

Copy `secrets.yaml` and fill in your values:

```yaml
local-simulation:
  secrets:
    APP_API_KEY: "your-api-key"
    APP_API_BASE_URL: "http://localhost:3000/api/v1"
    PRICE_INTEGRITY_ADDRESS: "0x..."
    REPORTER_PRIVATE_KEY: "0x..."
```

### Workflow Configuration

Each workflow has its own `config.json` in the `workflows/{name}/` directory:

```json
{
  "appApiBaseUrl": "http://localhost:3000/api/v1",
  "evms": [
    {
      "chainSelectorName": "ethereum-testnet-sepolia",
      "chainId": 11155111,
      "priceIntegrityAddress": "0x...",
      "gasLimit": "1000000"
    }
  ]
}
```

## Workflow 1: Price Integrity

### Purpose

Compares internal app OHLC candles vs Chainlink reference candles every 15 minutes, computes matching metrics, and submits a report to the `PriceIntegrity` contract.

### Trigger

- **Type:** Cron
- **Schedule:** Every 15 minutes (`*/15 * * * *`)

### Flow

1. Resolve target window (previous 15 minutes)
2. Check idempotency (skip if epoch already processed)
3. Fetch internal candles from app API
4. Fetch Chainlink candles from app API
5. Canonicalize (sort by timestamp)
6. Compute metrics:
   - Per-candle OHLC error in bps
   - MAE, P95, Max error
   - Direction match percentage
   - Outlier count
7. Compute score (weighted formula, 0-10000)
8. Derive pass/fail flags
9. Compute hashes (internal, Chainlink, diff Merkle root)
10. Submit report on-chain

### Metrics and Scoring

**Error Formula:**
```
err_i = (abs(Oi-Or)/Or + abs(Hi-Hr)/Hr + abs(Li-Lr)/Lr + abs(Ci-Cr)/Cr) / 4 * 10000
```

**Score Formula:**
```
sAcc = max(0, 10000 - MAE * 200)
sP95 = max(0, 10000 - P95 * 100)
sMax = max(0, 10000 - Max * 50)
sDir = directionMatchBps
sOut = max(0, 10000 - outlierRate * 2)

score = (5000*sAcc + 2000*sP95 + 1000*sMax + 1000*sDir + 1000*sOut) / 10000
```

**Pass Criteria:**
- Score >= 9000 (90%)
- P95 <= 50 bps (0.5%)

### Contract Call

```solidity
PriceIntegrity.submitBatchComparison(
  epochId,
  windowStart,
  candleCount,
  internalCandlesHash,
  chainlinkCandlesHash,
  ohlcMaeBps,
  ohlcP95Bps,
  ohlcMaxBps,
  directionMatchBps,
  outlierCount,
  scoreBps,
  diffMerkleRoot
)
```

### Testing

```bash
# Unit tests
bun test

# Local simulation
cre workflow simulate price-integrity --target local-simulation
```

## Mock API

For testing without real APIs, use the `MockAppApiClient`:

```typescript
const client = new MockAppApiClient();
client.matchRate = 0.95; // 95% match between internal and Chainlink
const candles = await client.getOhlcCandles(start, end, "internal");
```

## Dependencies

- `@chainlink/cre-sdk`: Chainlink Runtime Environment SDK
- `viem`: Ethereum interaction library
- `zod`: Schema validation

## License

MIT
