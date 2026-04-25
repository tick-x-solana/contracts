# TickX CRE

Chainlink CRE workflow project for TickX.

Current maintained scope is one workflow:

- `price-integrity`

This workflow fetches internal and reference OHLC candles, computes quality metrics, and submits a report to `PriceIntegrity` onchain.

## Project Structure

```text
cre/
├── price-integrity/
│   ├── main.ts
│   ├── workflow.yaml
│   ├── config.json
│   ├── types.ts
│   └── lib/
├── project.yaml
├── secrets.yaml
├── package.json
└── README.md
```

## Important Constraint

The CRE compiler cannot resolve `../` parent imports. Workflow-local files must stay inside the workflow directory.

## Quick Start

```bash
cd cre
bun install
bun run build
```

## Simulate

```bash
cre workflow simulate price-integrity --target worldchain
```

Broadcast:

```bash
export CRE_ETH_PRIVATE_KEY="<PRIVATE_KEY>"
cre workflow simulate price-integrity --target worldchain --broadcast
```

## Deployed Contracts

World Chain mainnet:

| Contract | Address |
|---|---|
| `PoolReserve` | `0x6351b3006aAE72a36006614310928930Ac229d0e` |
| `PriceIntegrity` | `0xB9F60C92168cafA09eaA13302FD11896Cb773268` |

## Config

Main files:

- [`project.yaml`](./project.yaml): target settings and RPC mapping
- [`price-integrity/workflow.yaml`](./price-integrity/workflow.yaml): workflow target declarations
- [`price-integrity/config.json`](./price-integrity/config.json): app API, chain selector, contract addresses, gas limit, and simulation window

Minimal runtime config shape:

```json
{
  "appApiBaseUrl": "https://api.example.com/api/v1",
  "simulationWindowStart": 1704067200,
  "simulationWindowEnd": 1704068100,
  "owner": "0x...",
  "evms": [
    {
      "chainSelectorName": "ethereum-mainnet-worldchain-1",
      "chainId": 480,
      "priceIntegrityAddress": "0x...",
      "gasLimit": "1000000"
    }
  ]
}
```

## Workflow Behavior

`price-integrity` does the following:

1. Resolve the reporting window
2. Fetch internal OHLC candles from the TickX API
3. Fetch reference OHLC candles
4. Compute MAE, P95, max error, direction match, and outlier count
5. Compute score and pass/fail flags
6. Hash both candle sets and diff root
7. Submit the report to `PriceIntegrity`

## Notes

- Target name is `worldchain`, while the chain selector used by CRE is `ethereum-mainnet-worldchain-1`.
- This directory is scoped to `PriceIntegrity`; broader workflow documentation has been removed.
