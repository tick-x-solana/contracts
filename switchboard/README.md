# TickX Switchboard Price Integrity

This folder contains the Switchboard-side workflow for Solana `PriceIntegrity`.

It also contains a mock `Settlement` batch generator for the Solana settlement program.

## Modes

There are 2 modes:

1. `synthetic-static` (default)
   - no HTTP server required
   - generates 2 synthetic 900-candle series
   - computes final metrics from those candles
   - stores 6 static `ValueTask` feeds on Switchboard
2. `http-worker`
   - fetches real OHLC data
   - computes metrics in the worker/server
   - serves metric endpoints over HTTP
   - Switchboard jobs read those endpoints

For now the default is `synthetic-static` via:

```bash
SWITCHBOARD_FAKE_METRICS=1
```

In this mode Switchboard does not call your API and does not need a public hostname.

## Files

- `src/worker.ts`
  - builds one synthetic passing snapshot or computes a real one from upstream OHLC
- `src/server.ts`
  - optional HTTP service for `http-worker` mode
- `src/jobs.ts`
  - builds either HTTP-backed jobs or static `ValueTask` jobs
- `src/deploy.ts`
  - stores the 6 job definitions with Crossbar on devnet
  - prints `feedHash` and canonical `quoteAccount`
  - does not send a managed update transaction
- `src/simulate.ts`
  - simulates each job against Crossbar before deployment
- `src/snapshot.ts`
  - refreshes only `syntheticSnapshot` inside the saved deployment JSON
  - keeps `feedIds` and `quoteAccount` unchanged

## Environment

Copy `.env.example` to `.env` and fill:

- `RPC_URL`
- `PAYER_KEYPAIR_PATH`
- `CROSSBAR_URL`
- `SWITCHBOARD_FAKE_METRICS`

Only for `http-worker` mode:

- `APP_API_BASE_URL`
- `APP_API_KEY`
- `METRICS_BASE_URL`

Important:

- By default the worker runs in synthetic mode and generates two random 900-candle series that produce passing metrics.
- Set `SWITCHBOARD_FAKE_METRICS=0` if you want to switch back to real OHLC fetching.
- `METRICS_BASE_URL` only matters in `http-worker` mode, and it must be publicly reachable by Switchboard oracles.

## Install

```bash
cd /Users/sniperman/code/tapfun-chainlink-sc/switchboard
npm install
```

## Simulate jobs

```bash
npm run simulate
```

In default synthetic mode, this simulates 6 static jobs whose values come from one generated passing snapshot.

## Deploy the 6 feeds on Switchboard devnet

```bash
npm run deploy:devnet
```

Expected output shape:

```json
{
  "queue": "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7",
  "mode": "synthetic-static",
  "syntheticSnapshot": {
    "candleCount": 900
  },
  "feeds": [
    {
      "metric": "ohlc_mae_bps",
      "feedHash": "...",
      "quoteAccount": "...",
      "mockValue": 7
    }
  ]
}
```

## Generate the next demo snapshot without redeploying feeds

```bash
npm run snapshot:devnet
```

This updates:

- `syntheticSnapshot.epochId`
- `syntheticSnapshot.windowStart`
- `syntheticSnapshot.windowEnd`
- `syntheticSnapshot.metrics`
- `feeds.*.mockValue`

It does not change:

- `queue`
- `feedIds`
- `quoteAccount`

## Optional HTTP mode

If you want the older bridge flow:

```bash
SWITCHBOARD_FAKE_METRICS=0 npm run server
SWITCHBOARD_FAKE_METRICS=0 npm run simulate
SWITCHBOARD_FAKE_METRICS=0 npm run deploy:devnet
```

The server exposes:

```text
GET /price-integrity?metric=ohlc_mae_bps
GET /price-integrity?metric=ohlc_p95_bps
GET /price-integrity?metric=ohlc_max_bps
GET /price-integrity?metric=direction_match_bps
GET /price-integrity?metric=outlier_count
GET /price-integrity?metric=score_bps
```

## Use with the Solana contract

After deploy, take:

- the devnet queue
- the 6 `feedHash` values in this exact order:
  1. `ohlc_mae_bps`
  2. `ohlc_p95_bps`
  3. `ohlc_max_bps`
  4. `direction_match_bps`
  5. `outlier_count`
  6. `score_bps`

Then initialize `sol-contracts/price-integrity` with:

- `--queue`
- `--feed-ids`

The quote account can be derived automatically from queue + ordered feed IDs.

Current devnet deployment config is stored at:

```text
switchboard/deployments/price-integrity-devnet.json
```

## Settlement mock batches

Generate the next settlement batch file for Solana `Settlement`:

```bash
npm run settlement:devnet
```

This writes:

```text
switchboard/deployments/settlement-devnet.json
```

The file contains:

- `windowStart`
- `windowEnd`
- `batches[]`
  - `batchId`
  - `merkleRoot`
  - `totalPayout`
  - `withdrawableCap`
  - `settlementCount`
  - `settlements[]`

Use that JSON with:

- `sol-contracts/settlement/client/src/bin/commit_from_json.rs`

Deploy 12 settlement feeds once:

```bash
npm run settlement:deploy:devnet
```

This writes:

```text
switchboard/deployments/settlement-switchboard-devnet.json
```

That file contains:

- `queue`
- `quoteAccount`
- `maxAgeSlots`
- `feedIds`
- `feedIdsCsv`

Prepare one batch commit payload without redeploying feeds:

```bash
npm run settlement:prepare:commit:devnet
```

This writes:

```text
switchboard/deployments/settlement-switchboard-commit-devnet.json
```

That file contains:

- stable feed config
- `batchIndex`
- `windowStart`
- `windowEnd`
- `selectedBatch`

For a stable TEE-compatible deployment:

1. run `npm run server` on a public host
2. set `SWITCHBOARD_FAKE_METRICS=0`
3. point `METRICS_BASE_URL` at that host
4. run `npm run settlement:deploy:devnet` once
5. initialize `sol-contracts/settlement` from `settlement-switchboard-devnet.json`
6. refresh the same feed IDs for each new batch window
7. run `npm run settlement:prepare:commit:devnet`
8. commit using `settlement-switchboard-commit-devnet.json`

## Default Switchboard devnet queue

From Switchboard docs:

```text
EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7
```

Source:
- https://docs.switchboard.xyz/docs-by-chain/solana-svm
