# Contract: Technology Compatibility Kit (minimal)

**IC-006** — Validates **published registry + MCP flows** for a **house-provisioned ghost** (no alternate provider tier).

## Environment

- Local stack running: `server/` dev process, reachable `registry` and `world-api`.
- House under test: reference implementation `ghosts/random-house/` unless TCK is parameterized for another GhostHouse.

## Ordered steps (pass/fail)

1. Register GhostHouse provider.
2. Adopt one ghost for one caretaker; obtain credentials and MCP parameters.
3. `get_ghost_position` → valid tile id.
4. `get_neighbors` → non-empty where map guarantees neighbors.
5. `move_ghost` to valid neighbor → success acknowledgment and observable state change via MCP subsequent reads.
6. `move_ghost` invalid → structured rejection with reason; position unchanged.
7. Clean shutdown: release handles; optional registry cleanup if defined.

## Output

- Non-zero exit code on first failure.
- stdout/stderr includes step label and server response summary for debugging.

Full formal TCK spec is explicitly deferred to a follow-up RFC; this checklist gates the PoC implementation.
