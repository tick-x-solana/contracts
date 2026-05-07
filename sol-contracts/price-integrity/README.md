# TickX Solana Price Integrity

Standalone Solana program for TickX `PriceIntegrity`, integrated with Switchboard on-demand feeds.

## Scope

This program is the Solana analogue of the EVM `PriceIntegrity` contract:

- stores batch reports by epoch
- computes pass/fail flags on-chain
- requires a verified Switchboard quote update in the same transaction
- accepts only a preconfigured canonical Switchboard quote account

It does not depend on CRE.

## Switchboard Pattern

The intended transaction ordering is:

1. Switchboard signature verification / managed update instructions
2. `commit_switchboard_batch_report` instruction from this program

The program expects:

- a configured `queue` account
- a configured canonical `quote_account`
- `slot_hashes` sysvar
- `instructions` sysvar
- `clock` sysvar

On commit it verifies the quote through `QuoteVerifier`, then reads metric feeds from the verified quote.

## Metric Feed Layout

The config stores six Switchboard feed IDs in fixed order:

1. `ohlc_mae_bps`
2. `ohlc_p95_bps`
3. `ohlc_max_bps`
4. `direction_match_bps`
5. `outlier_count`
6. `score_bps`

Batch metadata like `epoch_id`, `window_start`, `candle_count`, and the candle hashes are passed as instruction args and stored in the report PDA.

## Instructions

- `initialize`
  - creates the config PDA
  - stores `owner`, `queue`, canonical `quote_account`, `max_age_slots`, and the six metric feed IDs
- `set_switchboard_config`
  - owner-only update for the Switchboard queue, quote account, freshness threshold, and feed IDs
- `commit_switchboard_batch_report`
  - verifies the configured canonical quote account with `QuoteVerifier`
  - reads the six metric feeds from the verified quote
  - computes `failure_flags` and `is_passed`
  - stores a report PDA keyed by `epoch_id`

## Client Scripts

Client crate:

```bash
cd sol-contracts/price-integrity
cargo check --manifest-path client/Cargo.toml
```

Derive PDAs and canonical quote account:

```bash
cargo run --manifest-path client/Cargo.toml --bin print_pdas -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --queue <SWITCHBOARD_QUEUE> \
  --feed-ids <FEED_1>,<FEED_2>,<FEED_3>,<FEED_4>,<FEED_5>,<FEED_6> \
  --epoch-id 1
```

Initialize config:

```bash
cargo run --manifest-path client/Cargo.toml --bin initialize -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --queue <SWITCHBOARD_QUEUE> \
  --max-age-slots 30 \
  --feed-ids <FEED_1>,<FEED_2>,<FEED_3>,<FEED_4>,<FEED_5>,<FEED_6>
```

Initialize config directly from the Switchboard deployment JSON:

```bash
cargo run --manifest-path client/Cargo.toml --bin initialize_from_json -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/price-integrity-devnet.json
```

Update config:

```bash
cargo run --manifest-path client/Cargo.toml --bin set_switchboard_config -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --queue <SWITCHBOARD_QUEUE> \
  --max-age-slots 30 \
  --feed-ids <FEED_1>,<FEED_2>,<FEED_3>,<FEED_4>,<FEED_5>,<FEED_6>
```

Commit report after the Switchboard quote account has already been updated:

```bash
cargo run --manifest-path client/Cargo.toml --bin commit -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --queue <SWITCHBOARD_QUEUE> \
  --feed-ids <FEED_1>,<FEED_2>,<FEED_3>,<FEED_4>,<FEED_5>,<FEED_6> \
  --epoch-id 1974460 \
  --window-start 1704067200 \
  --candle-count 900 \
  --internal-candles-hash <0x...32bytes> \
  --chainlink-candles-hash <0x...32bytes> \
  --diff-merkle-root <0x...32bytes>
```

Manual demo trigger without Switchboard quote verification:

```bash
cargo run --manifest-path client/Cargo.toml --bin commit_demo_from_json -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/price-integrity-devnet.json \
  --diff-merkle-root 0x1111111111111111111111111111111111111111111111111111111111111111
```

Read a stored report PDA:

```bash
cargo run --manifest-path client/Cargo.toml --bin read_report -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --epoch-id 1975692
```

## Notes

- The canonical Switchboard quote account should be derived off-chain from queue + ordered feed IDs and then persisted in config.
- The consumer instruction should come after Switchboard update instructions in the same transaction.
- The commit instruction does not trust arbitrary quote accounts. It only accepts the `quote_account` stored in config, and the quote must also verify against the configured `queue`.
- In the current client scripts, the quote update itself is expected to happen outside the client, by your Switchboard workflow or cranker. The `commit` script only submits the consumer instruction against an already updated canonical quote account.
