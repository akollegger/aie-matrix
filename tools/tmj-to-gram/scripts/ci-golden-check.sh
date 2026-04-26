#!/usr/bin/env bash
# Re-convert every sandbox TMJ and assert byte equality with the committed .map.gram (IC-003 CI pattern).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$ROOT/tools/tmj-to-gram/dist/main.js"
SANDBOX="$ROOT/maps/sandbox"

if [[ ! -f "$CLI" ]]; then
  echo "ci-golden-check: missing $CLI — run pnpm --filter @aie-matrix/tmj-to-gram run build first." >&2
  exit 1
fi

failed=0
for tmj in "$SANDBOX"/*.tmj; do
  [[ -e "$tmj" ]] || continue
  stem=$(basename "$tmj" .tmj)
  golden="$SANDBOX/${stem}.map.gram"
  if [[ ! -f "$golden" ]]; then
    echo "ci-golden-check: missing committed golden for stem \"$stem\" — expected $golden" >&2
    failed=1
    continue
  fi
  tmp=$(mktemp "${TMPDIR:-/tmp}/tmj-gram-check.XXXXXX")
  if ! (cd "$ROOT" && node "$CLI" convert "$tmj" --out "$tmp"); then
    echo "ci-golden-check: convert failed for $tmj" >&2
    rm -f "$tmp"
    failed=1
    continue
  fi
  if ! diff -q "$golden" "$tmp" >/dev/null; then
    echo "ci-golden-check: drift detected for $stem (re-run converter and commit $golden)" >&2
    diff -u "$golden" "$tmp" >&2 || true
    rm -f "$tmp"
    failed=1
    continue
  fi
  rm -f "$tmp"
done

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
