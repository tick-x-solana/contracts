# TickX Solana Pool Reserve

Standalone Solana program for a native-SOL `PoolReserve`.

Current scope:

- native SOL only
- trader deposits into a program vault PDA
- admin-authorized trader claims
- owner-managed claim signer

No LP logic, no SPL token handling, no oracle/reporting path.

## Accounts

PDAs used by the program:

- `pool-reserve-config`
- `pool-reserve-vault`
- `trader-position:<trader_pubkey>`

## Instructions

- `Initialize { claim_signer }`
- `DepositTrader { amount }`
- `ClaimTrader { amount }`
- `SetClaimSigner { new_claim_signer }`

`ClaimTrader` requires the configured `claim_signer` to sign the transaction.

## Build

```bash
cd sol-contracts
cargo build-sbf
```

## Client Scripts

Host-side scripts live in `client/` and do not require Anchor.

Initialize:

```bash
cd sol-contracts
cargo run --manifest-path client/Cargo.toml --bin initialize -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --claim-signer <CLAIM_SIGNER_PUBKEY>
```

Deposit native SOL:

```bash
cd sol-contracts
cargo run --manifest-path client/Cargo.toml --bin deposit -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --amount-sol 0.1
```

Claim native SOL with the configured admin signer:

```bash
cd sol-contracts
cargo run --manifest-path client/Cargo.toml --bin claim -- \
  --rpc-url https://api.devnet.solana.com \
  --payer ~/.config/solana/id.json \
  --program-id <PROGRAM_ID> \
  --claim-signer ~/.config/solana/claim-signer.json \
  --trader <TRADER_PUBKEY> \
  --amount-sol 0.1
```

Deploy after build:

```bash
cd sol-contracts
solana program deploy target/deploy/tickx_pool_reserve_sol.so
```

## Notes

- The vault holds native lamports directly.
- Trader balances are accounted for in PDA state, not inferred from raw vault balance.
- Claims keep the vault rent exempt.
