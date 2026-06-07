# Quickstart: Resource Lifecycle (027)

## Prerequisites

- Node.js 24, pnpm 10
- Podman or Docker (for Neo4j integration tests)
- `pnpm install` from repo root

## Build & typecheck

```bash
pnpm run build          # must pass cleanly; hard gate before PR
pnpm typecheck          # supplementary
```

## Unit tests

```bash
# Grammar changes
cd shared/map-gram && pnpm test

# Ledger + ItemService + EvalContract
cd server/world-api && pnpm test
```

Key test files touching this branch:

| File | What it covers |
|---|---|
| `shared/map-gram/src/parse.test.ts` | `qty` on placements, `SpawnGrant` parsing, error on `[resources:Resources]` |
| `server/world-api/src/ItemService.test.ts` | `takeItem`/`dropItem` commit to ledger |
| `server/world-api/src/agent-resource-grants.test.ts` | spawn grants from map role |
| `server/world-api/src/EvalContractService.test.ts` | group payout to member bags |
| `server/world-api/test/LedgerService.bench.ts` | p95 commit latency (informational) |

## Integration tests (requires Neo4j)

```bash
# Start Neo4j
podman run -d --name neo4j-test \
  -e NEO4J_AUTH=neo4j/testpassword \
  -p 7687:7687 neo4j:5

export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=testpassword

cd server/world-api && pnpm test:integration
```

Integration tests are skipped when `NEO4J_URI` is unset.

## Smoke test (manual)

1. Start the server: `pnpm dev` from repo root
2. Connect a ghost client and call `take` on a tile with an item
3. Call `ledger_verify` (admin) — expect `{ entries: N, valid: true }`
4. Call `inventory` — expect the taken item to appear
5. Call `drop` — expect item to return to tile; `ledger_verify` still clean

## Verify removed symbols

```bash
grep -r "LedgerMonotonicTradeRejected\|ResourceType\|ItemDefinition\|resources:Resources" \
  server/ shared/ --include="*.ts"
# Expected: zero matches (test files excluded)
```
