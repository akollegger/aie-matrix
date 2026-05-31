# Quickstart: In-World Resource Ledger

## Prerequisites

- `pnpm install` from repo root
- Neo4j running locally (or `NEO4J_URI` set to a remote instance)
- A map with a `[resources:Resources | ...]` block (see sandbox map below)

## 1. Add a Resource Seed to a Map

Edit `maps/sandbox/sandbox.map.gram` (or any map) and add a resources block:

```gram
[resources:Resources {name: "Sandbox Resources"} |
  (:Resource { id: "gold", class: "conserved", qty: 100, floor: 0, label: "Gold" }),
  (:Resource { id: "xp",   class: "monotonic",  qty: 0,   floor: 0, label: "Experience" }),
]
```

Add a cost to an existing `GO` rule edge:

```gram
[rules:Rules |
  (red)-[:GO { cost: [{ qty: 5, resource: "gold", payee: "world" }] }]->(blue),
]
```

## 2. Start the Server

```bash
pnpm dev
```

The server starts a session for the configured map. On startup, `LedgerService` replays the Neo4j chain (or appends the genesis seed if none exists).

## 3. Verify via MCP

Spawn or connect a ghost, then call the `inventory` tool:

```bash
# Via ghost-cli
pnpm ghost:cli
> inventory
```

Expected output:
```json
{ "ok": true, "actorId": "ghost-xxx", "holdings": [{ "resource": "gold", "qty": 0, "label": "Gold" }] }
```

(Ghost starts with empty holdings; a server mechanic or direct seed credits them.)

## 4. Trigger a Cost via Movement

Move a ghost across a costed edge. The response includes a quote before committing:

```
Quote: crossing this edge costs 5 gold.
Accept? [y/N]
```

On acceptance, the receipt confirms the deduction and `inventory` reflects the new balance.

## 5. Run Unit Tests

```bash
pnpm --filter @aie-matrix/server-world-api test
```

The unit test suite covers:
- Conservation invariant across reward + spend sequences
- `InsufficientFunds` denial on underfunded costed moves
- Duplicate ULID rejection
- Monotonic resource accumulation and transfer rejection
- Hash chain tamper detection
- Bag rebuild from genesis

## 6. Run Integration Tests (requires Neo4j)

```bash
NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=password \
  pnpm --filter @aie-matrix/server-world-api test:integration
```

Integration tests additionally cover:
- Balance survival across server restart (replay-from-genesis)
- `(:LedgerEntry)` nodes written and read back correctly

## 7. Verify Ledger Integrity (admin MCP tool)

The `ledger_verify` tool is admin-only. Call it via MCP with the `ADMIN_TOKEN` bearer:

```bash
# Using ghost-cli in admin mode (bearer = ADMIN_TOKEN value from .env)
pnpm ghost:cli --bearer "$ADMIN_TOKEN"
> ledger_verify
```

Expected response on a clean chain:
```json
{ "ok": true, "entries": 3 }
```

Response when tampering is detected:
```json
{
  "ok": false,
  "code": "CHAIN_TAMPERED",
  "atId": "01JXYZ...",
  "expectedHash": "abc123...",
  "actualHash": "def456..."
}
```

Note: calling `ledger_verify` with a ghost token (not admin) returns a `401` auth error.

## Verification Checklist

- [ ] `inventory` returns correct holdings after a reward transaction
- [ ] A costed `GO` move quotes cost, deducts on accept, and reflects in `inventory`
- [ ] An underfunded move is denied with `INSUFFICIENT_FUNDS`; balance unchanged
- [ ] Conservation: sum of all bags for `gold` equals 100 at all times
- [ ] Server restart: balances after restart match pre-restart state
- [ ] Unit tests: `pnpm --filter @aie-matrix/server-world-api test` passes
