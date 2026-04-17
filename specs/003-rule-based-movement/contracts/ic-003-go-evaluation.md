# Contract IC-003-B: `go` evaluation and denial codes

**Consumers**: Ghost MCP clients (`@aie-matrix/ghost-ts-client`, TCK, reference houses)  
**Producer**: `@aie-matrix/server-world-api` (`evaluateGo` and MCP tool `go`)

## Purpose

Preserve existing geometry-first validation while layering **ruleset evaluation** for adjacent steps. Aligns with spec IC-001 / IC-002.

## Request

Unchanged: `GoArgs` with `toward: Compass` (see `@aie-matrix/shared-types`).

## Success response

Unchanged: `GoSuccess` with `ok: true`, `tileId` of destination cell.

## Failure response

`GoFailure` MUST include:

| Field | Requirement |
|-------|-------------|
| `ok` | `false` |
| `reason` | Non-empty human-readable string |
| `code` | Non-empty stable string for agents |

### Code taxonomy (extend as needed)

Existing codes remain valid:

| Code | Meaning |
|------|---------|
| `UNKNOWN_CELL` | Ghost not on a known cell |
| `NO_NEIGHBOR` | No traversable neighbor in direction |
| `MAP_INTEGRITY` | Map data inconsistent |
| `RULESET_DENY` | Geometrically valid step rejected by rules (allow-list) |

Implementations MAY introduce **more specific** subcodes (e.g. `RULESET_DENY_NO_MATCH`) **if** they remain documented in `shared/types` or ghost-facing docs and TCK is updated.

## Ordering of checks

1. Resolve current cell; fail with `UNKNOWN_CELL` if missing.
2. Resolve neighbor; fail with `NO_NEIGHBOR` if absent.
3. Validate destination record; fail with `MAP_INTEGRITY` if inconsistent.
4. If permissive rules mode → allow.
5. Else evaluate authored ruleset against origin/destination labels, direction, ghost context.
6. If no permit → `RULESET_DENY` (or more specific documented code) with explanatory `reason`.

## Observability

Server logs for denied moves SHOULD include ghost id, direction, origin/destination class labels, and `code` for operator debugging (no secrets).
