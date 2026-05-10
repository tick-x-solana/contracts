#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWITCHBOARD_DIR="$ROOT_DIR/switchboard"

PROGRAM_ID="${PROGRAM_ID:-}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
PAYER_PATH="${PAYER_PATH:-$HOME/.config/solana/id.json}"
CONFIG_JSON="${CONFIG_JSON:-$ROOT_DIR/switchboard/deployments/price-integrity-prod-devnet.json}"

usage() {
  cat <<'EOF'
Usage:
  PROGRAM_ID=<program_id> ./scripts/run_price_integrity_commit.sh

Environment variables:
  PROGRAM_ID   Required. Solana price-integrity program id.
  RPC_URL      Optional. Defaults to https://api.devnet.solana.com
  PAYER_PATH   Optional. Defaults to ~/.config/solana/id.json
  CONFIG_JSON  Optional. Defaults to switchboard/deployments/price-integrity-prod-devnet.json

This wrapper runs the production Switchboard cranker path:
  managed update bundle + commit_switchboard_batch_report
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$PROGRAM_ID" ]]; then
  echo "error: PROGRAM_ID is required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$CONFIG_JSON" ]]; then
  echo "error: config json not found: $CONFIG_JSON" >&2
  exit 1
fi

if [[ ! -x "$SWITCHBOARD_DIR/node_modules/.bin/tsx" ]]; then
  echo "==> Installing switchboard dependencies"
  (
    cd "$SWITCHBOARD_DIR"
    npm install
  )
fi

echo "==> Running production price-integrity cranker"
(
  cd "$SWITCHBOARD_DIR"
  npm run crank:devnet -- \
    --program-id "$PROGRAM_ID" \
    --rpc-url "$RPC_URL" \
    --payer "$PAYER_PATH" \
    --config-json "$CONFIG_JSON"
)
