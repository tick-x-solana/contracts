#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_IDL="$ROOT_DIR/sol-contracts/idl/pool_reserve.json"
OUT_PATH="${1:-$PWD/pool_reserve.idl.json}"

if [[ ! -f "$SOURCE_IDL" ]]; then
  echo "error: source idl not found: $SOURCE_IDL" >&2
  exit 1
fi

cp "$SOURCE_IDL" "$OUT_PATH"
echo "exported: $OUT_PATH"
