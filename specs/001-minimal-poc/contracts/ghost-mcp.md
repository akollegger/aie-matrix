# Contract: Ghost interaction (MCP)

**IC-003** — Adopted ghosts (including house-provisioned ghosts) interact with `server/world-api/` only through MCP tools. Ghosts do not use Colyseus client libraries.

## Naming

Tool identifiers are **short, imperative verbs** inspired by parser-fiction and classic text adventures (Zork, Adventure): you *look*, check *exits*, *go* somewhere, and ask *whoami* / *whereami* when disoriented. MCP **`description`** fields (and JSON Schema `description` on arguments) carry the same tone so LLM hosts surface them as natural affordances.

## Local frame (normative)

Ghosts **do not** name arbitrary distant tiles. Sensing and movement are always anchored to **the ghost’s current cell** using:

| Token | Meaning |
|--------|---------|
| `here` | The tile the ghost currently occupies. |
| `around` | All **face-adjacent** neighbors of `here` (up to six), as a bounded bundle — never the whole map. |
| `n`, `s`, `ne`, `nw`, `se`, `sw` | Short names for the **six hex faces** that may be traversable from `here` (flat-top layout; see [research.md](../research.md) “Ghost-facing compass”). |

**Responses** MAY include resolved **tile ids** for neighbors the ghost just learned about (for example from `exits`); that is not the same as accepting arbitrary tile ids **as ghost-supplied request parameters** for “telepathic” queries.

## Tools (normative names per RFC)

| Tool | Purpose |
|------|---------|
| `whoami` | Resolve the authenticated ghost’s identity for this session (`ghostId`, caretaker linkage, any debug labels the PoC exposes). **No spatial arguments.** |
| `whereami` | Current occupied **tile id** (and optional coordinates if the server chooses to echo them). **No spatial arguments.** |
| `look` | Inspect tile detail (class, occupants, optional map metadata — custom properties best-effort; **none required for PoC**, including `capacity`). **Single argument `at`**: `here` (default), `around`, or one of `n`, `s`, `ne`, `nw`, `se`, `sw` for the neighbor in that face direction. Requesting a face with **no neighbor** (map edge) returns a structured empty / not-there result — not an error about distant tiles. |
| `exits` | List exits **from here only** (no arguments): for each traversable face, return **`direction`** (`n`…`sw`) and the **neighbor tile id** the ghost would enter via that face. Non-traversable faces MAY be omitted or flagged with a reason code. |
| `go` | Step **one hex face** from here. **Required argument `toward`**: one of `n`, `s`, `ne`, `nw`, `se`, `sw`. The server resolves the neighbor tile from the compass table; **ghosts MUST NOT pass a destination tile id**. Success or structured rejection (blocked face, ruleset denial, off-map, etc.). |

## Semantics

- **Authentication**: Each tool call carries credentials derived from adoption output (exact mechanism: bearer header vs MCP session binding — document in implementation; must match `auth/`).
- **Validation**: All checks run in `world-api` on **`go`**: resolved neighbor must exist, then **movement ruleset** (edge-centric `(fromClass)->(toClass)` policy per RFC-0001; PoC default permissive). **Capacity and other tile custom properties are not validated for the PoC** unless explicitly added later. On acceptance, Colyseus state updates and spectator broadcast follow.
- **Rejection**: Response includes human- and machine-usable **reason**; ghost position unchanged (FR-011).

## Schema source

Canonical TypeScript definitions live in `shared/types/`; runtime discovery via MCP `tools/list` is authoritative for dynamic agents (see [research.md](../research.md)).
