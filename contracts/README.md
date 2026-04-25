# TickX Contracts

Foundry project for the TickX contract layer.

Current maintained scope:

- `PoolReserve.sol`
- `PriceIntegrity.sol`

Other legacy contracts may still exist in `src/`, but they are not the active product surface.

## Contracts

| Contract | Purpose |
|---|---|
| `PoolReserve.sol` | UUPS-upgradeable ERC20 reserve for trader deposits, Permit2 deposits, and admin-signed claims |
| `PoolReserveProxy.sol` | ERC1967 proxy used for `PoolReserve` deployments |
| `PriceIntegrity.sol` | Stores price-integrity batch reports received through `onReport` or direct submission |
| `abstracts/ReceiverTemplate.sol` | Shared forwarder-gated receiver base used by `PriceIntegrity` |

## Quick Start

```bash
forge build
forge test -vv
forge fmt
```

## Deployment Scripts

```bash
forge script script/DeployPoolReserve.s.sol:DeployPoolReserve --rpc-url "$RPC_URL" --broadcast
forge script script/UpgradePoolReserve.s.sol:UpgradePoolReserve --rpc-url "$RPC_URL" --broadcast
forge script script/DeployPriceIntegrity.s.sol:DeployPriceIntegrity --rpc-url "$RPC_URL" --broadcast
```

## Deployed Contracts

World Chain mainnet:

| Contract | Address |
|---|---|
| `PoolReserve` | `0x6351b3006aAE72a36006614310928930Ac229d0e` |
| `PriceIntegrity` | `0xB9F60C92168cafA09eaA13302FD11896Cb773268` |

## Structure

```text
src/
├── PoolReserve.sol
├── PoolReserveProxy.sol
├── PriceIntegrity.sol
├── Errors.sol
├── Events.sol
├── interfaces/
└── abstracts/

script/
├── DeployPoolReserve.s.sol
├── UpgradePoolReserve.s.sol
└── DeployPriceIntegrity.s.sol

test/
├── PoolReserve.t.sol
└── PriceIntegrity.t.sol
```

## Notes

- `PoolReserve` is trader-only in the current scope. LP flows and solvency reporting are out.
- `PriceIntegrity` is the reporting receiver used by the CRE workflow in `../cre`.
