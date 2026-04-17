# Implementation Plan: Ghost CLI

**Branch**: `004-ghost-cli` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-ghost-cli/spec.md`

## Summary

Add `ghosts/ghost-cli/` (`@aie-matrix/ghost-cli`) — a TypeScript pnpm workspace package that exposes the five MCP ghost tools as a one-shot CLI (using `@effect/cli` + `@effect/platform-node`) and an interactive text-adventure REPL (using Ink). The CLI wraps `@aie-matrix/ghost-ts-client` in an Effect `Layer.scoped` service (`GhostClientService`) and runs a three-phase pre-flight sequence that converts raw errors into actionable diagnostics before any MCP call. No server-side changes are required.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)
**Primary Dependencies**: `effect` v3+, `@effect/cli`, `@effect/platform-node`, `ink` (v5+), `react` (v18)
**Storage**: None (stateless CLI; reads `.env` via `@aie-matrix/root-env`)
**Testing**: Vitest (unit tests for pre-flight logic, REPL command parser, diagnostic messages)
**Target Platform**: Node.js 24, macOS/Linux terminal (TTY); degrades to plain output in non-TTY
**Project Type**: CLI tool (`bin` entry point via `pnpm start`)
**Performance Goals**: Pre-flight completes in < 2 s on local network; one-shot round-trip < 1 s for any MCP tool call
**Constraints**: Must not alter the world-api MCP interface or any server-side package; dependency on `@aie-matrix/ghost-ts-client` is read-only (no modifications to the client)
**Scale/Scope**: Single-contributor local development tool; one ghost session per CLI process

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Proposal linkage** PASS — [RFC-0003](../../proposals/rfc/0003-ghost-cli.md) documents the full design, motivation, and alternatives considered. Scope matches: new `ghosts/ghost-cli/` package, no server-side changes.
- **Boundary-preserving design** PASS — new package is a flat sibling under `ghosts/` per `ghosts/README.md` naming convention. No existing package is modified. `@aie-matrix/ghost-ts-client` is consumed as a read-only workspace dependency (same role as `random-house`). Server and registry packages are untouched.
- **Contract-explicit interfaces** PASS — Two new interface contracts are defined:
  - [IC-004](./contracts/ic-004-ghost-client-service.md): `GhostClientService` Effect service (boundary between CLI logic and MCP transport)
  - [IC-005](./contracts/ic-005-cli-exit-codes.md): exit code contract for shell script consumers
  - IC-003 (existing ghost MCP tool schemas) is consumed unchanged.
- **Verifiable increments** PASS — Four user stories map to independently demonstrable slices (see phased delivery below). Each has a concrete smoke test in the quickstart.
- **Documentation impact** PASS — `ghosts/README.md`, `docs/project-overview.md`, `specs/001-minimal-poc/quickstart.md`, root `package.json` (`poc:cli` alias — resolves RFC-0003 Q5).

**Post-Phase 1 re-check**: Confirm `GhostClientService` interface in contracts/ matches implemented TypeScript signature before Phase C.

## Project Structure

### Documentation (this feature)

```text
specs/004-ghost-cli/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-004-ghost-client-service.md
│   └── ic-005-cli-exit-codes.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code

```text
ghosts/ghost-cli/
├── package.json                    # @aie-matrix/ghost-cli, bin entry, workspace deps
├── tsconfig.json                   # extends ../../tsconfig.base.json
├── src/
│   ├── index.ts                    # NodeRuntime.runMain entry point
│   ├── cli.ts                      # @effect/cli Command tree (root, subcommands)
│   ├── config.ts                   # GhostConfig — @effect/cli Config layer
│   ├── diagnostics.ts              # formatDiagnostic(), toExitCode() — pure functions
│   ├── preflight/
│   │   ├── index.ts                # runPreflight() — sequential phase runner
│   │   ├── env-scan.ts             # Phase 1: token/URL presence and format
│   │   ├── reachability.ts         # Phase 2: HTTP probe to server health endpoint
│   │   └── handshake.ts            # Phase 3: MCP connect + whoami
│   ├── services/
│   │   └── GhostClientService.ts   # Context.Tag, Layer.scoped, GhostClientError types
│   ├── oneshot/
│   │   └── commands.ts             # one-shot Effect handlers: whoami, whereami, look, exits, go
│   └── repl/
│       ├── App.tsx                  # Ink root component — composes all panels
│       ├── StatusStrip.tsx          # connection state, ghost id, tile, server addr
│       ├── WorldView.tsx            # look here result as prose
│       ├── GhostPanel.tsx           # whoami + whereami summary
│       ├── ExitsPanel.tsx           # exits list
│       ├── LogPanel.tsx             # scrolling log strip
│       ├── InputBar.tsx             # readline prompt with queuing while disconnected
│       └── repl-state.ts           # Effect Refs for all panel state; ReplCommand parser
└── tests/
    ├── preflight.test.ts            # unit tests for Phase 1 env-scan (pure logic)
    ├── diagnostics.test.ts          # formatDiagnostic() coverage for all error types
    └── command-parser.test.ts       # ReplCommand parsing for all vocabulary + edge cases
```

**Structure Decision**: Single package under `ghosts/ghost-cli/` following the flat sibling rule in `ghosts/README.md`. No new top-level directories. React/Ink source files use `.tsx`; all other source is `.ts`. Tests live in `tests/` for consistency with other workspace packages.

## Phased Delivery

### Phase A — Package scaffold + one-shot commands

Covers FR-001 to FR-009, FR-016 to FR-019. Delivers User Story 1 (one-shot inspection) and User Story 4 (shell-scriptable JSON).

**Deliverables**:
- `package.json`, `tsconfig.json` — workspace membership, build scripts, `bin` entry
- `pnpm-workspace.yaml` updated to include `ghosts/ghost-cli`
- `config.ts` — `GhostConfig` via `@effect/cli` `Config`
- `services/GhostClientService.ts` — `Layer.scoped` wrapping `GhostMcpClient`
- `preflight/` — three-phase sequence with all `PreFlightError` types
- `diagnostics.ts` — `formatDiagnostic()`, `toExitCode()`
- `cli.ts` + `oneshot/commands.ts` — five one-shot subcommands with `--json` and `--debug`
- `index.ts` — `NodeRuntime.runMain` entry point
- `tests/preflight.test.ts`, `tests/diagnostics.test.ts`, `tests/command-parser.test.ts`

**Smoke test** (from quickstart):
```bash
export GHOST_TOKEN=<token> WORLD_API_URL=http://127.0.0.1:8787/mcp
pnpm --filter @aie-matrix/ghost-cli start -- whoami         # exits 0
pnpm --filter @aie-matrix/ghost-cli start -- exits --json  # valid JSON on stdout, exits 0
unset GHOST_TOKEN
pnpm --filter @aie-matrix/ghost-cli start -- whoami         # exits 1, diagnostic on stderr
```

---

### Phase B — Pre-flight diagnostic completeness

Covers FR-005 to FR-007 in full. Delivers User Story 2 (pre-flight self-rescue).

**Deliverables**:
- All nine `PreFlightError` variants implemented with distinct `formatDiagnostic` messages
- Phase 2 reachability probe distinguishes: `ECONNREFUSED` default port, `ECONNREFUSED` non-default port, `ENOTFOUND`, MCP-endpoint-404
- `diagnostics.test.ts` — full coverage for all nine error types

**Smoke test**:
```bash
# Server stopped:
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# Expected: "The world server isn't running … Start it with pnpm run poc:server."

# Wrong URL:
WORLD_API_URL=http://127.0.0.1:8787 pnpm --filter @aie-matrix/ghost-cli start -- whoami
# Expected: message includes "Try …/mcp"
```

---

### Phase C — Interactive REPL

Covers FR-010 to FR-015. Delivers User Story 3 (interactive world exploration).

**Deliverables**:
- `repl/` — all seven Ink components + `repl-state.ts`
- Non-TTY detection gate in `cli.ts` (auto-fallback to one-shot mode)
- Reconnect fiber: exponential-backoff retry; `connectionStateRef` updated throughout
- Command queuing during reconnect: replayed on reconnect
- World View, Ghost, Exits panels auto-refresh after any `go` command

**Smoke test**:
```bash
pnpm --filter @aie-matrix/ghost-cli start
# Green status strip appears; type "look around" then "go ne" then "exit"
```

---

### Phase D — Documentation and root alias

Resolves all documentation impact items from the spec and RFC-0003 Open Question 5.

**Deliverables**:
- `ghosts/README.md` — add `ghost-cli` row to packages table
- Root `package.json` — add `poc:cli` alias (recommended: yes)
- `docs/project-overview.md` — add `ghost-cli` mention
- `specs/001-minimal-poc/quickstart.md` — add CLI verification step

---

## Open Questions resolved

| RFC-0003 Question | Resolution |
|-------------------|-----------|
| Q1 — Token capture | Pre-flight instructs `pnpm run poc:ghost`; token capture improvement deferred |
| Q2 — Auto-refresh cadence | Command-driven only (simpler, sufficient for PoC) |
| Q3 — `look around` rendering | Replaces Exits panel with neighbour detail; revisit if too verbose |
| Q4 — Non-TTY fallback | Handled in Phase A via `process.stdout.isTTY` check |
| Q5 — `poc:cli` alias | Yes — added in Phase D |

## Complexity Tracking

No constitution violations requiring justification.
