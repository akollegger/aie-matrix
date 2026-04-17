# RFC-0003: ghost-cli — Human-Operated Ghost CLI

**Status:** draft  
**Date:** 2026-04-17  
**Authors:** @akollegger  
**Related:** [RFC-0001](0001-minimal-poc.md) · [ADR-0001](../adr/0001-mcp-ghost-wire-protocol.md) · [ADR-0002](../adr/0002-adopt-effect-ts.md) · [IC-003](../../specs/001-minimal-poc/contracts/ghost-mcp.md)

## Summary

Add `ghosts/ghost-cli/` — a TypeScript package built on `@effect/cli`,
`@effect/platform-node`, and Ink (React terminal renderer) that exposes the five
MCP ghost tools (`whoami`, `whereami`, `look`, `exits`, `go`) as both a scriptable
one-shot command and an interactive text-adventure REPL with a multi-panel terminal
UI. The CLI treats itself as a **collaborative diagnostic partner**: it actively
probes its environment, identifies failure causes before reporting them, attempts
self-healing where possible, and otherwise gives the contributor the exact next step
to take — never a raw error trace. Authentication is assumed to have already
occurred; the CLI accepts a bearer token via `--token` flag or `GHOST_TOKEN`
environment variable and a world-api base URL via `--url` flag or `WORLD_API_URL`
environment variable. It is not a GhostHouse and does not perform registration or
adoption.

## Motivation

The MCP ghost interface is currently exercised only by autonomous processes
(`random-house`) and the TCK smoke test. Contributors onboarding to the project
have no way to drive a ghost by hand to inspect world state, reproduce movement
failures, or understand the local-frame interaction model without reading ghost
implementation code or wiring up a test harness themselves.

Three concrete pain points this resolves:

**Onboarding.** A new contributor following the quickstart can witness the adopted
ghost walking randomly but cannot ask "what does `look around` return here?" or
"why did `go nw` fail?" without instrumenting code. An interactive REPL removes
that barrier. The CLI's diagnostic layer means a contributor who forgets to start
the server, or hasn't yet captured a token, gets a clear remediation step rather
than a connection error and a blank stare.

**Debugging.** When a movement ruleset change produces unexpected behaviour,
reproducing the failure requires either modifying `random-house` or writing a
one-off script. A scriptable one-shot command (`ghost-cli go nw --json`) makes the
MCP surface directly interrogable from a shell, with typed failure codes that can
be grepped or piped without parsing log noise.

**Contributor reference.** The text-adventure framing of the ghost tools (`look`,
`exits`, `go`) is intentional — IC-003 — but is not experienced as such by
contributors who only read the spec. A REPL that presents the world in
adventure-game style reinforces the design intent and gives it a natural home in
the repo.

## Design

### Technology layer

`ghost-cli` uses three complementary libraries, each owning a distinct layer:

**`@effect/cli` + `@effect/platform-node`** — command definition, argument and
option parsing, `--help` generation, shell completions, `--version`, and the
entire pre-flight and error-handling pipeline. All failure modes are typed
`Data.TaggedError` values; no raw exceptions surface. `NodeRuntime.runMain` manages
process lifecycle, SIGTERM, and exit codes. `@effect/cli`'s `Config` system
resolves `GHOST_TOKEN` and `WORLD_API_URL` from environment variables declaratively
alongside flag definitions, eliminating manual `process.env` checks.

**`@aie-matrix/ghost-ts-client`** — MCP connection and tool calls, consumed as an
Effect service (`GhostClientService`) via `Layer`. Retry schedules and reconnection
logic are expressed as Effect `Schedule` values wrapping the client service, not
imperative loops.

**Ink** — reactive multi-panel terminal UI for interactive mode only. Ink renders
React components to stdout; the data flowing into those components comes from
Effect state (Refs, Queues). Effect and Ink do not conflict: Effect drives the
logic, Ink renders the view.

This mirrors the established project pattern: Effect for orchestration and typed
errors (ADR-0002), with a rendering layer on top.

### Package placement and identity

`ghosts/ghost-cli/` — a pnpm workspace member (`@aie-matrix/ghost-cli`) as a flat
sibling under `ghosts/`, consistent with the naming convention in `ghosts/README.md`.
It is not a GhostHouse provider and does not touch `server/registry/`.

### Credential resolution

`@effect/cli`'s `Config` layer resolves connection parameters in this order of
precedence:

1. CLI flags: `--token <jwt>` and `--url <base-url>`
2. Environment variables: `GHOST_TOKEN` and `WORLD_API_URL`
3. `.env` file at the repository root, loaded via `@aie-matrix/root-env` consistent
   with `random-house` and the combined server

If either value is absent after all three sources are checked, the CLI enters the
pre-flight diagnostic path (see below) rather than exiting with a generic error.

### Pre-flight: active environment probing

Before any MCP connection is attempted, the CLI runs a three-phase pre-flight
sequence. Each phase is a typed Effect that short-circuits with a structured
diagnostic on failure; later phases do not run until earlier ones pass. Pre-flight
runs at every startup and on each reconnect attempt in interactive mode.

**Phase 1 — Environment scan** (no network, instant)

Checks that token and URL are present and well-formed. Inspects the current working
directory and `.env` presence to contextualise remediation messages. Illustrative
diagnostics:

| Condition | Message |
|-----------|---------|
| `GHOST_TOKEN` absent, appears to be in repo root | "No ghost token. Run `pnpm run poc:ghost` to adopt a ghost and capture its token." |
| `GHOST_TOKEN` absent, not in repo root | "No ghost token. You appear to be outside the repo root — try `cd <repo>` first, then `pnpm run poc:ghost`." |
| `WORLD_API_URL` absent, `.env` present | "No world API URL. Add `WORLD_API_URL=http://127.0.0.1:8787/mcp` to your `.env`, or pass `--url`." |
| URL present but missing `/mcp` suffix | "The URL `<url>` looks like a server base URL. Try `<url>/mcp`." |

**Phase 2 — Reachability probe** (fast HTTP to the server's spectator health endpoint)

Distinguishes "server not running" from "wrong host/port" from "wrong MCP path"
before the MCP handshake. Illustrative diagnostics:

| Condition | Message |
|-----------|---------|
| `ECONNREFUSED` on default port | "The world server isn't running at `127.0.0.1:8787`. Start it with `pnpm run poc:server` from the repo root." |
| `ECONNREFUSED` on non-default port | "Nothing is listening at `<host>:<port>`. Is the server running on a different port?" |
| `ENOTFOUND` | "Hostname `<host>` can't be resolved. Check `WORLD_API_URL` for typos." |
| Server reachable, `/mcp` returns 404 | "The server is running but the MCP endpoint wasn't found at `<url>`. The correct path is usually `/mcp`." |

**Phase 3 — MCP handshake and identity check** (`connect` + `whoami`)

Confirms the token is valid and the ghost exists. Illustrative diagnostics:

| Condition | Message |
|-----------|---------|
| 401 from world-api | "Your ghost token was rejected. Tokens expire when the server restarts. Re-run `pnpm run poc:ghost` to get a fresh one." |
| 404 / ghost not found | "The server doesn't recognise this ghost. It may have been evicted after a server restart. Re-adopt with `pnpm run poc:ghost`." |
| Handshake succeeds | Pre-flight passes silently; CLI proceeds. |

### Failure taxonomy and self-healing stance

Every failure falls into one of three stances, each with a distinct presentation:

**Self-healing** — the CLI retries without asking. Transient network hiccups, brief
server restarts during development. In interactive mode the status strip shows
reconnect state and the CLI retries with exponential backoff (an Effect `Schedule`).
In one-shot mode a single retry is attempted before giving up. No user action is
needed unless retries are exhausted.

**Guided resolution** — the CLI cannot fix this but knows exactly what to do.
Expired token, missing env var, wrong URL. The CLI states what it found, what it
expected, and the single concrete command or edit that resolves it. One step, not a
list of possibilities.

**Informative blocking** — neither the CLI nor the user can resolve this
immediately, or the root cause is ambiguous. The CLI states plainly what it observed
and where to look (server terminal, server logs). It does not claim to know more
than it does.

Raw error traces, stack frames, and MCP protocol internals never appear in default
output. A `--debug` flag enables verbose logging including raw MCP payloads and the
full Effect cause chain, for contributors diagnosing protocol-level issues.

The diagnostic voice is that of a knowledgeable colleague: it states what is known,
not just what failed; it gives one concrete next step when one exists; it clearly
distinguishes "wait, I'm retrying" from "you need to do something."

### Two operating modes

**One-shot mode** — a single MCP tool call, result printed to stdout, process exits.
Suitable for shell scripts, CI checks, and manual spot-inspection. Pre-flight runs
before the call; any failure exits non-zero with a diagnostic on stderr, never a
stack trace.

```
ghost-cli <command> [args] [flags]
```

Examples:

```bash
ghost-cli whoami
ghost-cli whereami --json
ghost-cli look here
ghost-cli look around --json
ghost-cli exits
ghost-cli go ne
ghost-cli go ne --debug     # raw MCP payload and Effect cause on stderr
```

`--json` emits the raw MCP tool result as JSON. Default output is human-readable
prose matching the text-adventure register of the IC-003 tool descriptions.

**Interactive REPL mode** — a persistent terminal UI that keeps the MCP connection
open and accepts commands in a readline loop. Launched when no command verb is
given, or explicitly with `--interactive`.

```bash
ghost-cli --interactive
ghost-cli          # also enters interactive mode
```

### Interactive UI layout

The interactive mode renders a multi-panel Ink interface. A connection status strip
runs across the top of the layout and reflects live connection state at all times.

```
● CONNECTED   ghost: g-001   tile: cyan-04   server: 127.0.0.1:8787
┌─────────────────────────────────┬─────────────────────┐
│  WORLD VIEW                     │  GHOST              │
│                                 │  id:    g-001       │
│  You are at tile: cyan-04       │  tile:  cyan-04     │
│  Class: Cyan                    │  col:   3  row: 2   │
│  Occupants: none                │                     │
│                                 ├─────────────────────┤
│  Exits:                         │  EXITS              │
│    ne → teal-07                 │  ne  teal-07        │
│    sw → cyan-02                 │  sw  cyan-02        │
│                                 │                     │
├─────────────────────────────────┴─────────────────────┤
│  LOG                                                   │
│  [10:42:01] moved ne → cyan-04                        │
│  [10:41:58] blocked: no tile to the nw (NO_NEIGHBOR)  │
│  [10:41:55] connected as g-001                        │
├────────────────────────────────────────────────────────┤
│  > _                                                   │
└────────────────────────────────────────────────────────┘
```

The status strip transitions on connection state changes:

```
◌ RECONNECTING   lost connection — retrying in 3s   (attempt 2 of 5)
✗ DISCONNECTED   server unreachable — start with: pnpm run poc:server
⚠ TOKEN EXPIRED  re-adopt to continue: pnpm run poc:ghost
```

Panels:

- **Status strip** (top, always visible) — connection state, ghost identity, current
  tile, server address. Color-coded: green when connected, yellow when reconnecting,
  red when blocked.
- **World View** (left, tall) — result of the most recent `look here` call, rendered
  as prose. Refreshed automatically after any `go` command.
- **Ghost** (top right) — identity and current position from `whoami` / `whereami`,
  updated after each move.
- **Exits** (bottom right) — current exit list, updated after any navigation command.
- **Log** (bottom strip) — scrolling message history: command results, diagnostic
  messages, connection events, and movement failures with their human-readable reason.
  Windowed to terminal height. Never shows raw error traces.
- **Input** (bottom line) — readline prompt. Grayed out and queuing while
  disconnected; commands typed during a reconnect attempt are replayed on reconnect.

### REPL command vocabulary

Commands use the same local-frame tokens defined in IC-003:

| Input | MCP tool call |
|-------|---------------|
| `whoami` | `whoami` |
| `whereami` | `whereami` |
| `look` or `look here` | `look { at: "here" }` |
| `look around` | `look { at: "around" }` |
| `look <face>` | `look { at: <face> }` where face ∈ `n s ne nw se sw` |
| `exits` | `exits` |
| `go <face>` | `go { toward: <face> }` |
| `help` | prints the vocabulary above with one-line descriptions |
| `exit` or `quit` or Ctrl-C | graceful disconnect and exit |

Unknown input prints a short inline error and the `help` vocabulary; the connection
remains open.

Movement failures (`RULESET_DENY`, `NO_NEIGHBOR`, `UNKNOWN_CELL`) appear in the log
as game feedback — "blocked: no tile to the nw" — not as errors. Infrastructure
failures (token rejected, server unreachable) surface in the status strip with
remediation guidance.

### Relationship to existing packages

`ghost-cli` consumes `@aie-matrix/ghost-ts-client` via an Effect service layer, in
the same role as `random-house`, and adds no new server-side surface. The world-api
MCP interface is unchanged. The package follows the Effect service/Layer patterns
established in ADR-0002 and documented in `docs/guides/effect-ts.md`.

### Demo scenario

With the combined server running (`pnpm run poc:server`) and a ghost already adopted
(e.g. via `pnpm run poc:ghost` in another shell, which logs the token and URL):

```bash
export GHOST_TOKEN=<token-from-adoption>
export WORLD_API_URL=http://127.0.0.1:8787/mcp

# One-shot: confirm identity
pnpm --filter @aie-matrix/ghost-cli start -- whoami

# One-shot: check exits as JSON
pnpm --filter @aie-matrix/ghost-cli start -- exits --json

# Interactive REPL
pnpm --filter @aie-matrix/ghost-cli start
# → status strip shows ● CONNECTED, panels populate
# → type `look around` to inspect neighbours
# → type `go ne` to move; World View and Ghost panels refresh
```

To verify the diagnostic layer works, run without a token:

```bash
unset GHOST_TOKEN
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# → pre-flight phase 1 fails with a message explaining how to obtain a token
```

A new contributor should complete the one-shot flow within 5 minutes of having the
combined server running, and the interactive REPL within 10 — including encountering
and resolving at least one pre-flight diagnostic.

## Open Questions

1. **Token capture in the quickstart.** Pre-flight can explain that a token is
   needed and how to get one, but `poc:ghost` currently logs the token mixed with
   other output. Should a `poc:ghost` variant write the token to `.env`
   automatically? This affects how precise the phase-1 remediation message can be
   and whether the demo scenario above can be simplified to "run one command."

2. **Auto-refresh cadence.** Should the World View and Ghost panels poll for updates
   while the ghost is idle (reflecting other occupants arriving or leaving), or
   update only on user-issued commands? Command-driven refresh is simpler and
   sufficient for single-contributor debugging; polling is more useful in
   multi-ghost demos but introduces an additional Effect fiber.

3. **`look around` rendering.** `look { at: "around" }` returns up to six
   `TileInspectResult` values. Should `look around` replace the exits display with
   neighbour detail, or render as a separate section? The right answer likely depends
   on how verbose `TileInspectResult` payloads are in practice.

4. **Non-TTY fallback.** When stdout is not a TTY (pipe, CI), the CLI should detect
   this at pre-flight and fall back to one-shot / plain-text mode automatically
   rather than crashing. This is likely a small implementation concern but worth
   surfacing as a named behaviour.

5. **`poc:cli` root alias.** Should a `poc:cli` alias be added to the root
   `package.json` alongside `poc:ghost` and `poc:server`, or is
   `pnpm --filter @aie-matrix/ghost-cli start` sufficient for the PoC phase?

## Alternatives

**Extend the TCK with interactive mode.** The TCK already connects to a live stack
and exercises MCP tools. Adding a `--interactive` flag there would avoid a new
package, but conflates compatibility-testing with exploratory debugging. The TCK's
contract is to exit 0 or non-zero, not to host a REPL session; its diagnostic
posture — assert and report — is the inverse of what the CLI needs.

**Instrument `random-house` with a debug flag.** Adding verbose logging or a
pause-on-each-move flag to `random-house` would expose tool results without a new
package, but keeps interaction autonomous — a contributor can observe but not steer.
Steering, and choosing which tool to call next, is the capability missing.

**Use the MCP Inspector (external tool).** Anthropic's
`@modelcontextprotocol/inspector` can connect to any MCP server and invoke tools
interactively via a browser UI. It is a valid debugging option today and worth
documenting in the quickstart. It is not a replacement for `ghost-cli` because: it
requires a browser alongside the terminal; it has no ghost-session awareness (the
JWT must be injected manually per request); it presents generic JSON rather than the
adventure-game framing; it cannot be scripted for one-shot shell use; and it has no
diagnostic layer that understands this project's environment.

**Plain Effect without `@effect/cli`.** Using `effect` directly with lightweight
`process.argv` parsing keeps the dependency count lower and avoids `@effect/cli`'s
abstraction. The trade-off is losing auto-generated `--help`, `--version`, shell
completions, and the `Config` environment integration that makes credential
resolution declarative. Given the onboarding goal, `--help` quality matters;
`@effect/cli` earns its place.

**Blessed / neo-blessed instead of Ink.** `blessed` offers richer widget primitives
(scrollable boxes with native overflow, mouse support) and does not require React.
It is largely unmaintained; `neo-blessed` receives occasional updates but has a
smaller ecosystem and no Effect integration path. Ink is the industry standard for
new TypeScript TUI work in 2025–2026 (Claude Code, Gemini CLI, Amp all use it),
aligns with the React knowledge already present in `client/phaser/`, and has a
clean composition story with an Effect runtime underneath it.
