# IC-003: MCP Tool Set (Ghost House Proxy)

**Status**: Accepted  
**Consumers**: Ghost agents (call these tools), ghost house MCP proxy (validates and forwards), catalog service (validates `matrix.requiredTools` at registration)  
**Source of truth**: [ADR-0001: MCP Ghost Wire Protocol](../../../proposals/adr/0001-mcp-ghost-wire-protocol.md), world-api package (`server/world-api/src/mcp-server.ts`)

## Purpose

Define the set of MCP tools the ghost house MCP proxy re-exposes to spawned agents. Agents declare which tools they require in `matrix.requiredTools` (IC-001); the proxy validates availability at registration and forwards calls to the world server using the ghost's credentials.

Third-party agents never interact with the world server directly — they only see the house MCP endpoint.

## Tool Set

| Tool | Phase | Description | Key inputs | Key outputs |
|------|-------|-------------|-----------|------------|
| `whereami` | 1 | Return current ghost position | — | `{ h3Index: string }` (H3 res-15) |
| `look` | 1 | Describe the current cell and visible surroundings | — | Cell description, nearby ghosts, items |
| `exits` | 1 | List traversable exits from current cell | — | `{ exits: Exit[], nonAdjacent: NonAdjacentExit[] }` |
| `go` | 1 | Move to an adjacent cell | `{ toward: string }` (direction or H3) | `{ ok: boolean, tileId: string }` |
| `traverse` | 1 | Use a named non-adjacent exit (elevator, portal) | `{ via: string }` | `{ ok: boolean, to: string, from: string }` |
| `inventory` | 1 | List items the ghost carries | — | `{ items: Item[] }` |

Future tools (quests, social) will be added in later phases and declared here when introduced.

## MCP Proxy Behavior

The ghost house MCP proxy:

1. **Authenticates the agent** via `Authorization: Bearer <ghost-token>` on inbound calls
2. **Resolves the ghost identity** from the active session (maps token → ghostId → world server credentials)
3. **Forwards the call** to the world server MCP endpoint using the ghost's credentials
4. **Returns the response** to the agent unchanged

Agents never see world server URLs or world server credentials. The proxy enforces that agents only call tools listed in their `matrix.requiredTools`.

## Tool Validation at Registration

When a contributed agent registers, the catalog service checks that every tool in `matrix.requiredTools` exists in the above tool set. If an agent declares a tool that does not exist, registration is rejected with an error listing the unknown tool names.

Agents that call tools not in their `matrix.requiredTools` at runtime get a proxy rejection (not forwarded to world server).

## H3 Index Convention

All cell positions use H3 resolution 15 indices (per RFC-0004 / `docs/architecture.md`). The `whereami` and `go` tools return `h3Index` as a hex string of this resolution. The TCK validates this invariant.

## TCK Validation

The Wanderer TCK validates:
1. `whereami` returns `{ h3Index }` as a valid H3 res-15 string
2. `exits` returns at least one traversable exit
3. `go` with a valid direction returns `{ ok: true, tileId: string }` where `tileId` is H3 res-15
4. `go` with an invalid direction returns an error (does not crash the proxy)
5. An agent calling a tool not in its `requiredTools` gets a proxy rejection
