#!/usr/bin/env bash
# scripts/preflight.sh
#
# Simulates the production-deploy front-end build in a clean state.
# Run before pushing a tag to catch workspace build failures locally.
#
#   bash scripts/preflight.sh
#
# Exits non-zero on the first failure.

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
RED="\033[31m"
RESET="\033[0m"

pass() { echo -e "${GREEN}✓${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; exit 1; }
step() { echo -e "\n${BOLD}── $* ${RESET}"; }

# ── 1. VITE_API_BASE_URL ──────────────────────────────────────────────────────

step "Check VITE_API_BASE_URL"
if [ -z "${VITE_API_BASE_URL:-}" ]; then
  echo "   VITE_API_BASE_URL is not set — using https://matrix.relateby.dev for this check"
  export VITE_API_BASE_URL=https://matrix.relateby.dev
else
  echo "   Using VITE_API_BASE_URL=$VITE_API_BASE_URL"
fi
pass "VITE_API_BASE_URL present"

# ── 2. Clean dist/ and tsbuildinfo (simulate fresh CI) ───────────────────────

step "Clean workspace dist/ directories and tsbuildinfo files"
find . -path ./node_modules -prune -o -name dist -type d -print | while read -r d; do
  rm -rf "$d"
  echo "   removed $d"
done
find . -path ./node_modules -prune -o -name "*.tsbuildinfo" -print | while read -r f; do
  rm -f "$f"
  echo "   removed $f"
done
pass "dist/ directories and tsbuildinfo files removed"

# ── 3. Install ────────────────────────────────────────────────────────────────

step "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
pass "install complete"

# ── 4. Build workspace deps for Intermedium ───────────────────────────────────

step "Build workspace deps (root-env, shared-types, map-gram, server-colyseus)"
pnpm --filter @aie-matrix/root-env \
     --filter @aie-matrix/shared-types \
     --filter @aie-matrix/map-gram \
     --filter @aie-matrix/server-colyseus \
     build
pass "workspace deps built"

# ── 5. Build Intermedium ──────────────────────────────────────────────────────

step "Build Intermedium (clients/intermedium)"
pnpm --filter ./clients/intermedium build
pass "Intermedium built → clients/intermedium/dist/"

# ── 6. Build Admin ────────────────────────────────────────────────────────────

step "Build Admin (tools/map-editor)"
pnpm --filter ./tools/map-editor build
pass "Admin built → tools/map-editor/dist/"

# ── Done ──────────────────────────────────────────────────────────────────────

echo -e "\n${GREEN}${BOLD}Preflight passed.${RESET} Safe to push a tag."
