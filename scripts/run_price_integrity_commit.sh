#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRICE_INTEGRITY_DIR="$ROOT_DIR/sol-contracts/price-integrity"
SWITCHBOARD_DIR="$ROOT_DIR/switchboard"

RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
PAYER_PATH="${PAYER_PATH:-$HOME/.config/solana/id.json}"
CONFIG_JSON="${CONFIG_JSON:-$ROOT_DIR/switchboard/deployments/price-integrity-devnet.json}"
MODE="${MODE:-demo}"
REFRESH_SNAPSHOT="${REFRESH_SNAPSHOT:-0}"
DIFF_MERKLE_ROOT="${DIFF_MERKLE_ROOT:-0x1111111111111111111111111111111111111111111111111111111111111111}"

usage() {
  cat <<'EOF'
Usage:
  PROGRAM_ID=<program_id> ./scripts/run_price_integrity_commit.sh

Environment variables:
  PROGRAM_ID          Required. Solana price-integrity program id.
  MODE                Optional. `demo` (default) or `direct`.
  RPC_URL             Optional. Defaults to https://api.devnet.solana.com
  PAYER_PATH          Optional. Defaults to ~/.config/solana/id.json
  CONFIG_JSON         Optional. Defaults to switchboard/deployments/price-integrity-devnet.json
  REFRESH_SNAPSHOT    Optional. Set to 1 to run `npm run snapshot:devnet` before commit.
  DIFF_MERKLE_ROOT    Optional. Used by demo mode. Defaults to 0x11..11

Notes:
  - `demo` mode uses `commit_demo_from_json` and works end-to-end with the checked-in JSON.
  - `direct` mode uses `commit`, which only sends the consumer instruction. It assumes the
    configured Switchboard quote account has already been updated by an external workflow/cranker.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${PROGRAM_ID:-}" ]]; then
  echo "error: PROGRAM_ID is required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$CONFIG_JSON" ]]; then
  echo "error: config json not found: $CONFIG_JSON" >&2
  exit 1
fi

ensure_switchboard_deps() {
  if [[ ! -x "$SWITCHBOARD_DIR/node_modules/.bin/tsx" ]]; then
    echo "==> Installing switchboard dependencies"
    (
      cd "$SWITCHBOARD_DIR"
      npm install
    )
  fi
}

if [[ "$MODE" != "demo" && "$MODE" != "direct" ]]; then
  echo "error: MODE must be either 'demo' or 'direct'" >&2
  exit 1
fi

extract_json_field() {
  local expr="$1"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expr = process.argv[2];
    const value = expr.split(".").reduce((acc, key) => acc[key], data);
    if (value === undefined) process.exit(2);
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
    } else {
      process.stdout.write(String(value));
    }
  ' "$CONFIG_JSON" "$expr"
}

ensure_switchboard_deps

if [[ "$REFRESH_SNAPSHOT" == "1" ]]; then
  echo "==> Refreshing synthetic snapshot"
  (
    cd "$SWITCHBOARD_DIR"
    npm run snapshot:devnet
  )
fi

EPOCH_ID="$(extract_json_field "syntheticSnapshot.epochId")"
WINDOW_START="$(extract_json_field "syntheticSnapshot.windowStart")"
CANDLE_COUNT="$(extract_json_field "syntheticSnapshot.candleCount")"
QUEUE="$(extract_json_field "queue")"
FEED_IDS_CSV="$(extract_json_field "feedIdsCsv")"
INTERNAL_HASH="$(extract_json_field "syntheticSnapshot.internalCandlesHash")"
CHAINLINK_HASH="$(extract_json_field "syntheticSnapshot.chainlinkCandlesHash")"

echo "==> Committing price-integrity report"
echo "program_id=$PROGRAM_ID"
echo "mode=$MODE"
echo "epoch_id=$EPOCH_ID"
echo "window_start=$WINDOW_START"
echo "candle_count=$CANDLE_COUNT"
echo "config_json=$CONFIG_JSON"

if [[ "$MODE" == "demo" ]]; then
  (
    cd "$PRICE_INTEGRITY_DIR"
    cargo run --manifest-path client/Cargo.toml --bin commit_demo_from_json -- \
      --rpc-url "$RPC_URL" \
      --payer "$PAYER_PATH" \
      --program-id "$PROGRAM_ID" \
      --config-json "$CONFIG_JSON" \
      --diff-merkle-root "$DIFF_MERKLE_ROOT"
  )
else
  (
    cd "$PRICE_INTEGRITY_DIR"
    cargo run --manifest-path client/Cargo.toml --bin commit -- \
      --rpc-url "$RPC_URL" \
      --payer "$PAYER_PATH" \
      --program-id "$PROGRAM_ID" \
      --queue "$QUEUE" \
      --feed-ids "$FEED_IDS_CSV" \
      --epoch-id "$EPOCH_ID" \
      --window-start "$WINDOW_START" \
      --candle-count "$CANDLE_COUNT" \
      --internal-candles-hash "$INTERNAL_HASH" \
      --chainlink-candles-hash "$CHAINLINK_HASH" \
      --diff-merkle-root "$DIFF_MERKLE_ROOT"
  )
fi

echo "==> Reading stored report"
(
  cd "$PRICE_INTEGRITY_DIR"
  cargo run --manifest-path client/Cargo.toml --bin read_report -- \
    --rpc-url "$RPC_URL" \
    --payer "$PAYER_PATH" \
    --program-id "$PROGRAM_ID" \
    --epoch-id "$EPOCH_ID"
)
