# Feature Specification: Ghost CLI — Human-Operated Ghost Terminal

**Feature Branch**: `004-ghost-cli`
**Created**: 2026-04-17
**Status**: Draft
**Input**: User description: "A ghost cli for onboarding contributors as described in the rfc @proposals/rfc/0003-ghost-cli.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0003](../../proposals/rfc/0003-ghost-cli.md) · [ADR-0002](../../proposals/adr/0002-adopt-effect-ts.md) · [IC-003](../001-minimal-poc/contracts/ghost-mcp.md)
- **Scope Boundary**: A standalone CLI package (`ghosts/ghost-cli/`) that exposes the five MCP ghost tools (`whoami`, `whereami`, `look`, `exits`, `go`) as one-shot commands and as an interactive text-adventure REPL. Includes active pre-flight environment probing and human-readable diagnostic guidance. Accepts credentials via flag or environment variable.
- **Out of Scope**: Ghost registration, adoption, or authentication flows (no GhostHouse behavior). Server-side changes. Any modification to the world-api MCP interface. Browser-based UIs. CI/CD pipeline changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — First-Time Contributor One-Shot Inspection (Priority: P1)

A new contributor has just completed the quickstart, has the combined server running, and has a ghost token from `pnpm run poc:ghost`. They want to confirm the ghost is alive and see where it is.

**Why this priority**: This is the first contact a contributor has with the ghost MCP surface. It must work immediately and be self-explanatory. Failure to work here blocks all further exploration.

**Independent Test**: Run `ghost-cli whoami` and `ghost-cli whereami` with a valid token and URL set — both return human-readable output and exit 0. Can be demonstrated without any other CLI feature.

**Acceptance Scenarios**:

1. **Given** `GHOST_TOKEN` and `WORLD_API_URL` are set, **When** the contributor runs `ghost-cli whoami`, **Then** the ghost's identity is printed in plain prose and the process exits 0.
2. **Given** `GHOST_TOKEN` and `WORLD_API_URL` are set, **When** the contributor runs `ghost-cli whereami --json`, **Then** the raw MCP tool result is emitted as JSON and the process exits 0.
3. **Given** `GHOST_TOKEN` is absent, **When** the contributor runs `ghost-cli whoami`, **Then** a human-readable message explains how to obtain a token (`pnpm run poc:ghost`) and the process exits non-zero — no stack trace appears.

---

### User Story 2 — Pre-Flight Diagnostics Guide Self-Rescue (Priority: P2)

A contributor forgets to start the world server, or has a stale token after a server restart, and runs the CLI. The CLI identifies the problem and tells them the single command to fix it.

**Why this priority**: Without actionable diagnostics, contributors become stuck and may abandon the project. The diagnostic layer is a core feature of the RFC, not an add-on.

**Independent Test**: Run `ghost-cli whoami` with server stopped — observe clear "server not running" message with `pnpm run poc:server` remedy. Run with expired token — observe "token rejected" message with `pnpm run poc:ghost` remedy. Neither scenario shows a raw error.

**Acceptance Scenarios**:

1. **Given** the world server is not running, **When** the contributor runs any one-shot command, **Then** the CLI prints "The world server isn't running at `<addr>`. Start it with `pnpm run poc:server`" and exits non-zero.
2. **Given** the ghost token has expired (server restarted), **When** the contributor runs any one-shot command, **Then** the CLI prints a message explaining the token is stale and instructs `pnpm run poc:ghost` to get a fresh one.
3. **Given** `WORLD_API_URL` is set to the server base URL without `/mcp`, **When** the contributor runs any one-shot command, **Then** the CLI suggests appending `/mcp` to the URL.

---

### User Story 3 — Interactive REPL for World Exploration (Priority: P3)

A contributor wants to explore the world interactively — issuing `look`, `exits`, and `go` commands and watching the world state update in a multi-panel terminal UI.

**Why this priority**: The REPL reinforces the text-adventure design intent of the ghost tools (IC-003) and gives contributors a real understanding of local-frame navigation, but requires more infrastructure than one-shot mode.

**Independent Test**: Launch `ghost-cli` with no subcommand — observe multi-panel Ink UI with status strip, world view, ghost identity, and exits panels. Type `look here` — world view updates. Type `go ne` — ghost panel and exits panel update to reflect new position.

**Acceptance Scenarios**:

1. **Given** valid credentials, **When** `ghost-cli` is launched with no arguments, **Then** a multi-panel terminal UI appears with a green status strip showing ghost identity and current tile.
2. **Given** the REPL is running, **When** the contributor types `go ne`, **Then** the World View, Ghost, and Exits panels update to reflect the new position and the log strip records the move.
3. **Given** the REPL is running and a `go` command fails (no neighbor), **Then** the log strip shows a game-style message ("blocked: no tile to the nw") rather than an error trace, and the connection remains open.
4. **Given** the server restarts mid-session, **When** the connection drops, **Then** the status strip shows `◌ RECONNECTING` with a countdown and the CLI retries automatically without user action.

---

### User Story 4 — Shell-Scriptable One-Shot for Debugging (Priority: P4)

A contributor is debugging a movement ruleset change and wants to drive specific MCP tool calls from a shell script or CI check.

**Why this priority**: Scripted one-shot use requires typed exit codes and JSON output, which is straightforward to add once P1 works.

**Independent Test**: Script calls `ghost-cli go ne --json` in a loop, greps the JSON result for `RULESET_DENY`, and exits with a non-zero code when the denial rate exceeds a threshold.

**Acceptance Scenarios**:

1. **Given** `--json` flag is passed, **When** any one-shot command succeeds, **Then** the raw MCP tool result is printed as valid JSON to stdout with no other output mixed in.
2. **Given** a movement fails with `RULESET_DENY`, **When** `ghost-cli go <face> --json` is run, **Then** the failure is represented in the JSON output and the process exits non-zero.
3. **Given** `--debug` flag is passed, **When** any command runs, **Then** raw MCP payloads and full error details appear on stderr, leaving stdout clean for piping.

---

### Edge Cases

- What happens when stdout is not a TTY (piped to another command or CI)? The CLI detects non-TTY context at startup and falls back to one-shot / plain-text mode rather than crashing or rendering corrupted UI.
- What happens when the ghost is evicted after a server restart? Phase 3 pre-flight catches the 404 and reports "ghost not found — re-adopt with `pnpm run poc:ghost`."
- What happens when `WORLD_API_URL` is missing entirely but `.env` is present? Phase 1 pre-flight instructs adding `WORLD_API_URL=http://127.0.0.1:8787/mcp` to the `.env` file.
- What happens when an unknown command is typed in the REPL? An inline error with the `help` vocabulary is displayed and the connection stays open.
- What happens when the contributor types `exit` or presses Ctrl-C in the REPL? The CLI disconnects gracefully and exits 0.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The CLI MUST expose all five MCP ghost tools (`whoami`, `whereami`, `look`, `exits`, `go`) as one-shot subcommands.
- **FR-002**: The CLI MUST accept a bearer token via `--token` flag or `GHOST_TOKEN` environment variable, with flags taking precedence.
- **FR-003**: The CLI MUST accept a world-api base URL via `--url` flag or `WORLD_API_URL` environment variable, with flags taking precedence.
- **FR-004**: The CLI MUST support loading `GHOST_TOKEN` and `WORLD_API_URL` from a `.env` file at the repository root as a fallback when neither flag nor environment variable is present.
- **FR-005**: The CLI MUST run a three-phase pre-flight sequence (environment scan, reachability probe, MCP handshake and identity check) before any MCP call, and short-circuit with a structured diagnostic on any phase failure.
- **FR-006**: Pre-flight diagnostics MUST state what was found, what was expected, and the single concrete command or edit that resolves the issue — no raw error traces in default output.
- **FR-007**: The CLI MUST distinguish three failure stances: self-healing (retry silently), guided resolution (one concrete fix step), and informative blocking (state what was observed and where to look).
- **FR-008**: One-shot commands MUST print human-readable prose by default; `--json` MUST emit the raw MCP tool result as valid JSON to stdout.
- **FR-009**: A `--debug` flag MUST enable verbose logging including raw MCP payloads and full error details on stderr only, leaving stdout clean.
- **FR-010**: The CLI MUST enter interactive REPL mode when launched with no subcommand or with `--interactive`.
- **FR-011**: Interactive mode MUST render a multi-panel terminal UI with: status strip (connection state, ghost identity, tile, server address), World View (last `look here` result), Ghost panel (identity and position), Exits panel, scrolling Log strip, and readline input.
- **FR-012**: The status strip MUST reflect live connection state with distinct visual states for connected, reconnecting, disconnected, and token-expired conditions.
- **FR-013**: In interactive mode, the CLI MUST retry the MCP connection automatically with exponential backoff on transient disconnects, displaying reconnect state in the status strip without requiring user action.
- **FR-014**: The REPL MUST support the command vocabulary: `whoami`, `whereami`, `look [here|around|<face>]`, `exits`, `go <face>`, `help`, `exit`/`quit`/Ctrl-C.
- **FR-015**: Movement failures (`RULESET_DENY`, `NO_NEIGHBOR`, `UNKNOWN_CELL`) MUST appear in the log as game-style feedback, not as errors.
- **FR-016**: The CLI MUST detect non-TTY stdout at startup and fall back to one-shot / plain-text mode rather than rendering interactive UI.
- **FR-017**: One-shot mode MUST attempt a single retry on transient failures before exiting non-zero.
- **FR-018**: The CLI MUST provide `--help` output listing all commands, flags, and environment variables.
- **FR-019**: The CLI MUST exit non-zero on any pre-flight or MCP failure in one-shot mode.

### Key Entities

- **Ghost Session**: A live connection to the world-api MCP endpoint authenticated by a bearer token, associated with a specific ghost identity and current tile position.
- **Pre-flight Result**: A structured diagnostic value produced by each pre-flight phase, carrying a pass/fail status, observed condition, and (on failure) a human-readable remediation message.
- **Connection State**: An enumerated value (`CONNECTED`, `RECONNECTING`, `DISCONNECTED`, `TOKEN_EXPIRED`) driving the status strip display.
- **REPL Command**: A parsed user input mapped to an MCP tool call, or to a local action (`help`, `exit`).
- **Log Entry**: A timestamped, human-readable message written to the log strip: command results, movement outcomes, connection events, and diagnostics.

### Interface Contracts

- **IC-001**: `ghost-cli` consumes `@aie-matrix/ghost-ts-client` as an Effect service layer (`GhostClientService`). The client service interface (tool call signatures, error types) is the contract boundary — the CLI must not depend on client internals.
- **IC-002**: One-shot `--json` output MUST be the verbatim MCP tool result object, parseable by downstream shell scripts without knowledge of CLI internals.
- **IC-003**: Exit codes: `0` = success, `1` = configuration/pre-flight failure (user-fixable), `2` = infrastructure failure (server not running), `3` = authentication failure (token expired/invalid).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new contributor with the combined server running and a valid token can complete a one-shot `whoami` call within 5 minutes of first encountering the CLI.
- **SC-002**: A contributor who runs the CLI without a token or with a stopped server receives a diagnostic message that leads them to the correct fix without consulting any other documentation.
- **SC-003**: A contributor can launch the interactive REPL, navigate to an adjacent tile, and read back the updated world state within 10 minutes of starting the combined server.
- **SC-004**: No raw error traces, stack frames, or MCP protocol internals appear in default output (non-`--debug`) for any failure condition covered by the pre-flight diagnostic layer.
- **SC-005**: One-shot `--json` output is valid JSON that passes `JSON.parse` without error for all tool calls that succeed or produce a structured MCP failure result.
- **SC-006**: The CLI handles server restart mid-session in interactive mode without requiring the contributor to manually restart the CLI, recovering automatically within the configured retry window.

## Assumptions

- Contributors are running the CLI from the repository root or from `ghosts/ghost-cli/` using `pnpm --filter @aie-matrix/ghost-cli start`.
- Authentication (ghost adoption) is assumed to have already occurred; the CLI accepts a token but does not perform registration or adoption.
- The world server is reachable at `127.0.0.1:8787` by default during local development.
- Terminal width is sufficient to render the multi-panel Ink layout (minimum 80 columns); narrower terminals receive a degraded but functional single-column layout.
- The ghost represented by the token is already adopted and registered in the world; the CLI does not handle ghost creation.
- `pnpm run poc:ghost` (defined elsewhere in the project) is the authoritative command for adopting a ghost and obtaining a token; pre-flight diagnostics reference this command.

## Documentation Impact *(mandatory)*

- `ghosts/README.md` — add `ghost-cli` entry alongside other ghost packages
- `docs/project-overview.md` — mention `ghost-cli` as the recommended interactive debugging tool
- Quickstart section of `specs/001-minimal-poc/quickstart.md` — add `ghost-cli` to the "verify your setup" step
- RFC-0003 open question 5: decide whether to add `poc:cli` alias to root `package.json`
