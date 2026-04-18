# Quickstart: Rule-Based Movement

Verification for [spec.md](./spec.md). Paths are from the **repository root** unless noted.

## Prerequisites

- `pnpm install`
- Same PoC stack as [001-minimal-poc quickstart](../001-minimal-poc/quickstart.md) when exercising MCP end-to-end.

## 1. Unit tests (primary gate)

```bash
pnpm --filter @aie-matrix/server-world-api test
```

Covers Gram parse fixtures, `evaluateGo` with authored vs permissive rules, asymmetric **A→B / B→B / deny B→A**, and switching rules files without changing map data.

## 2. Configuration

See `server/world-api/README.md` and root `.env.example`.

```bash
# Default: permissive (unset = no Gram file required)
unset AIE_MATRIX_RULES

# Authored allow-list (repo-relative or absolute path to a .gram file)
export AIE_MATRIX_RULES=server/world-api/src/rules/fixtures/demo-asymmetric.rules.gram
```

Then start the combined server (`pnpm run server` or `pnpm dev`). **Invalid Gram in authored mode** exits the process during startup.

## 3. Manual MCP check (optional)

With `authored` + `demo-asymmetric.rules.gram`, adopt a ghost on a **Red** tile (see sandbox map: one **Red** cell is placed on the mostly-**Blue** field), then drive `go` per User Story 3 in [spec.md](./spec.md).
