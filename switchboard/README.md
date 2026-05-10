# TickX Switchboard Workflows

This folder contains the Switchboard-side integration for Solana `PriceIntegrity`.

`PriceIntegrity` now runs only on the real API-backed path:

- metrics are fetched from the TickX API
- the public HTTP server exposes those metrics to Switchboard jobs
- feeds are deployed once on devnet
- a cranker sends one combined Solana transaction:
  - Switchboard managed update bundle
  - `commit_switchboard_batch_report`

The old fake/synthetic metrics path is removed from `price-integrity`.

Settlement tooling is still present separately and remains experimental.

## Files

- `src/worker.ts`
  - fetches real OHLC data
  - computes the current 15-minute `PriceIntegrity` snapshot
- `src/server.ts`
  - exposes metric endpoints and the full computed report
- `src/jobs.ts`
  - builds HTTP-backed `HttpTask -> JsonParseTask` jobs
- `src/deploy.ts`
  - stores the 6 job definitions with Crossbar
  - writes feed configuration data needed by the consumer contract
- `src/price_integrity_crank.ts`
  - production cranker
  - computes the current snapshot
  - fetches the Switchboard managed update bundle
  - appends the Solana consumer instruction
  - sends one combined transaction
- `src/simulate.ts`
  - simulates the current HTTP-backed jobs against Crossbar

## Environment

Copy `.env.example` to `.env` and fill:

- `RPC_URL`
- `PAYER_KEYPAIR_PATH`
- `CROSSBAR_URL`
- `APP_API_BASE_URL`
- `APP_API_KEY`
- `METRICS_BASE_URL`
- `PORT`

Notes:

- `METRICS_BASE_URL` must be publicly reachable by Switchboard oracles.
- the HTTP server must stay available continuously if you expect feeds to update continuously.
- the cranker process can run privately; only the metrics server must be public.

## Install

```bash
cd /Users/sniperman/code/tapfun-chainlink-sc/switchboard
npm install
```

## 1. Run the metrics server

```bash
npm run server
```

The server exposes:

```text
GET /price-integrity?metric=ohlc_mae_bps
GET /price-integrity?metric=ohlc_p95_bps
GET /price-integrity?metric=ohlc_max_bps
GET /price-integrity?metric=direction_match_bps
GET /price-integrity?metric=outlier_count
GET /price-integrity?metric=score_bps
GET /price-integrity/report
```

`/price-integrity/report` returns:

- `epochId`
- `windowStart`
- `windowEnd`
- `candleCount`
- `internalCandlesHash`
- `chainlinkCandlesHash`
- `diffMerkleRoot`
- `metrics`

## 2. Simulate jobs

```bash
npm run simulate
```

## 3. Deploy feeds once on devnet

```bash
npm run deploy:prod:devnet
```

This writes:

```text
switchboard/deployments/price-integrity-prod-devnet.json
```

The file contains:

- `queue`
- `quoteAccount`
- `feedIds`
- `feedIdsCsv`
- `maxAgeSlots`
- `metricsBaseUrl`

## 4. Initialize or update the Solana contract

Use the client in `sol-contracts/price-integrity` with:

- `initialize_from_json`
- or `set_switchboard_config_from_json`

against:

```text
switchboard/deployments/price-integrity-prod-devnet.json
```

## 5. Run the production cranker

```bash
npm run crank:devnet -- \
  --program-id <PRICE_INTEGRITY_PROGRAM_ID> \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/price-integrity-prod-devnet.json
```

This sends one Solana transaction containing:

1. Switchboard managed update bundle
2. `commit_switchboard_batch_report`

That is the correct production ordering.

## 6. Schedule every 15 minutes

Example cron:

```cron
*/15 * * * * cd /Users/sniperman/code/tapfun-chainlink-sc/switchboard && npm run crank:devnet -- --program-id <PRICE_INTEGRITY_PROGRAM_ID> --rpc-url https://api.devnet.solana.com --payer ~/.config/solana/id.json --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/price-integrity-prod-devnet.json >> /tmp/price-integrity-crank.log 2>&1
```

Important:

- Switchboard oracle nodes resolve the jobs and produce verified updates.
- your cranker still sends the combined Solana transaction.
- the Switchboard network does not host this repo or run your cron for you.

## Current production deployment file

```text
switchboard/deployments/price-integrity-prod-devnet.json
```

## Settlement

Settlement tooling is still present in this folder, but the verified feed-based architecture hit payload-size and feed-shape limits. It should be treated as experimental, not production-ready.
