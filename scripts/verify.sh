#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[verify] repo root: $ROOT"

command -v bun >/dev/null || { echo "[verify][FAIL] bun not found in PATH"; exit 1; }

echo "[verify] bun test"
bun test

echo "[verify] bun build plugin"
bun build ./src/plugin.ts --outdir ./dist --target bun \
  --external @opencode-ai/plugin --external @opencode-ai/sdk --external zod

echo "[verify] grep: avoid JSON.parse on LLM content"
grep -RIn 'JSON.parse(response\.choices\[0\]\.message\.content' "$ROOT/src" || true

echo "[verify] OK"
