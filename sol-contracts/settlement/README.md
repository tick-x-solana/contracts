# TickX Solana Settlement

Standalone Solana program for TickX `Settlement`.

Scope:

- owner-authorized settlement batch commit
- stores one PDA per batch
- stores paid amount per `(batch_id, account)` PDA
- no CRE dependency
- no Switchboard quote verification path

## Accounts

PDAs:

- `settlement-config`
- `settlement-batch:<batch_id>`
- `settlement-paid:<batch_id>:<account>`

## Instructions

- `Initialize`
- `CommitSettlementBatch`
- `MarkPaid`

## Build

```bash
cd /Users/sniperman/code/tapfun-chainlink-sc/sol-contracts/settlement
cargo build-sbf
```

## Client Scripts

Initialize:

```bash
cargo run --manifest-path client/Cargo.toml --bin initialize -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID>
```

Commit one stored batch from the generated settlement JSON:

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
