# CRE Workflow Specs (PoC)

This folder defines the 5 Chainlink Runtime Environment (CRE) workflows for this project.

## Files

- `00-cre-principles.md`: CRE execution rules and constraints that all workflows must follow.
- `01-price-integrity-workflow.md`: 15-minute OHLC batch comparison and onchain integrity report.
- `02-settlement-workflow.md`: 15m cron settlement batch commitment via `commitSettlementBatch(...)`.
- `03-pool-solvency-por-workflow.md`: daily solvency proof-of-reserve reporting.
- `04-lp-distribution-workflow.md`: daily cron LP reserve allocation and distribution queueing from app API batches.
- `05-strategy-rebalance-workflow.md`: volatility-regime driven parameter updates.

## Contract Touchpoints

- `PriceIntegrity.sol`
- `Settlement.sol`
- `PoolReserve.sol`
- `LPDistributor.sol`
- `StrategyManager.sol`

## Important PoC Decision

- CRE computes price matching metrics and score off-chain.
- Smart contracts store the submitted metrics and pass/fail flags.
- Threshold misses are stored with flags; they are not rejected.
