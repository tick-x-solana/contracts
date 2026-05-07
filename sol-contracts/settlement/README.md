# TickX Solana Settlement

Standalone Solana program for TickX `Settlement`.

Scope:

- Switchboard-verified settlement batch commit
- stores one PDA per batch
- stores paid amount per `(batch_id, account)` PDA
- owner-only dev fallback commit path

## Accounts

PDAs:

- `settlement-config`
- `settlement-batch:<batch_id>`
- `settlement-paid:<batch_id>:<account>`

## Instructions

- `Initialize`
- `CommitSwitchboardSettlementBatch`
- `SetSwitchboardConfig`
- `CommitDemoSettlementBatch` (dev only)
- `MarkPaid`

## Build

```bash
cd /Users/sniperman/code/tapfun-chainlink-sc/sol-contracts/settlement
cargo build-sbf
```

## Client Scripts

Initialize from Switchboard config:

```bash
cargo run --manifest-path client/Cargo.toml --bin initialize_from_json -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/settlement-switchboard-devnet.json
```

Update Switchboard config from JSON after redeploying feeds:

```bash
cargo run --manifest-path client/Cargo.toml --bin set_switchboard_config_from_json -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/settlement-switchboard-devnet.json
```

Commit one verified batch using Switchboard quote/feed config:

```bash
cargo run --manifest-path client/Cargo.toml --bin commit_switchboard_batch -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --queue <SWITCHBOARD_QUEUE> \
  --feed-ids <FEED_1>,<FEED_2>,<FEED_3>,<FEED_4>,<FEED_5>,<FEED_6>,<FEED_7>,<FEED_8>,<FEED_9>,<FEED_10>,<FEED_11>,<FEED_12> \
  --batch-id <0xBATCH_ID>
```

Direct Rust commit from prepared JSON only sends the consumer instruction. It is not the full verified Switchboard path:

```bash
cargo run --manifest-path client/Cargo.toml --bin commit_switchboard_batch_from_json -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/settlement-switchboard-commit-devnet.json
```

For the verified path, use the combined Switchboard transaction script:

```bash
cd /Users/sniperman/code/tapfun-chainlink-sc/switchboard
npm run settlement:commit:devnet -- \
  --program-id <PROGRAM_ID> \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/settlement-switchboard-commit-devnet.json
```

Dev-only local commit from generated settlement JSON:

```bash
cargo run --manifest-path client/Cargo.toml --bin commit_from_json -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --config-json /Users/sniperman/code/tapfun-chainlink-sc/switchboard/deployments/settlement-devnet.json \
  --batch-index 0
```

Read a stored batch:

```bash
cargo run --manifest-path client/Cargo.toml --bin read_batch -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --batch-id <0xBATCH_ID>
```

Mark paid for an account:

```bash
cargo run --manifest-path client/Cargo.toml --bin mark_paid -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --batch-id <0xBATCH_ID> \
  --beneficiary <ACCOUNT_PUBKEY> \
  --amount 1000000
```

Read a paid record:

```bash
cargo run --manifest-path client/Cargo.toml --bin read_paid -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --batch-id <0xBATCH_ID> \
  --beneficiary <ACCOUNT_PUBKEY>
```
