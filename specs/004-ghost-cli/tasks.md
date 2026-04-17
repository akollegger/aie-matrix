# Tasks: Ghost CLI — Human-Operated Ghost Terminal

**Input**: Design documents from `specs/004-ghost-cli/`
**Branch**: `004-ghost-cli`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **RFC**: [RFC-0003](../../proposals/rfc/0003-ghost-cli.md)

**Tests**: Smoke tests and unit tests are included per the plan. Unit tests cover the
pure pre-flight logic, diagnostic message formatting, and REPL command parser — all areas
that can be validated without a live server.

**Organization**: Tasks are grouped by user story (mapped to plan Phases A–D) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no inter-task dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup (Package Scaffold)

**Purpose**: Create the `ghosts/ghost-cli/` pnpm workspace package so subsequent phases
have a place to land. Nothing in this phase is functional; it just establishes the skeleton.

- [ ] T001 Add `ghosts/ghost-cli` to `pnpm-workspace.yaml` (one line addition after `ghosts/random-house`)
- [ ] T002 Create `ghosts/ghost-cli/package.json` — name `@aie-matrix/ghost-cli`, private, ESM, scripts: `build`, `typecheck`, `start`, `test`; deps: `effect`, `@effect/cli`, `@effect/platform-node`, `ink`, `react`; workspace deps: `@aie-matrix/ghost-ts-client`, `@aie-matrix/root-env`
- [ ] T003 [P] Create `ghosts/ghost-cli/tsconfig.json` extending `../../tsconfig.base.json`, add `jsx: react-jsx` for `.tsx` files, include `src/**/*`
- [ ] T004 [P] Create directory skeleton: `ghosts/ghost-cli/src/preflight/`, `src/services/`, `src/oneshot/`, `src/repl/`, `tests/`
- [ ] T005 Create stub `ghosts/ghost-cli/src/index.ts` (empty main, NodeRuntime.runMain placeholder) so `pnpm build` succeeds
- [ ] T006 Run `pnpm install` from repo root and verify `@aie-matrix/ghost-cli` appears in workspace; run `pnpm --filter @aie-matrix/ghost-cli run build` — must succeed

**Checkpoint**: `pnpm --filter @aie-matrix/ghost-cli run build` exits 0

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that every user story depends on — credential resolution,
Effect service layer, and the pre-flight type system. No user story can be implemented
until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T007 Create `ghosts/ghost-cli/src/config.ts` — `GhostConfig` interface and `@effect/cli` `Config` layer resolving `token` (`--token` / `GHOST_TOKEN` / `.env`), `url` (`--url` / `WORLD_API_URL` / `.env`), `debug` (`--debug`, boolean), `json` (`--json`, boolean)
- [ ] T008 Create `ghosts/ghost-cli/src/services/GhostClientService.ts` — `GhostClientError` tagged error types (`GhostClient.NetworkError`, `GhostClient.ProtocolError`, `GhostClient.ToolError` with `{ code, message }`); `GhostClientService` `Context.Tag`; `GhostClientLayer` as `Layer.scoped` wrapping `GhostMcpClient` from `@aie-matrix/ghost-ts-client` — connect on acquire, disconnect in `Effect.addFinalizer`
- [ ] T009 [P] Create `ghosts/ghost-cli/src/preflight/index.ts` — `runPreflight(config)` that runs phases 1–3 sequentially, short-circuiting on the first `PreFlightError`; returns `Effect.Effect<GhostIdentity, PreFlightError>`
- [ ] T010 [P] Create `ghosts/ghost-cli/src/preflight/env-scan.ts` — Phase 1: validates `token` and `url` presence and format; yields `PreFlight.EnvMissingToken`, `PreFlight.EnvMissingUrl`, `PreFlight.UrlMissingMcpSuffix` as appropriate; detects `inRepoRoot` by checking for `pnpm-workspace.yaml` in cwd ancestors
- [ ] T011 [P] Create `ghosts/ghost-cli/src/preflight/reachability.ts` — Phase 2: fast HTTP probe to `<host>:<port>/` (server health); yields `PreFlight.ServerUnreachable` (with `errno`), `PreFlight.HostNotFound`, `PreFlight.McpEndpointNotFound`
- [ ] T012 [P] Create `ghosts/ghost-cli/src/preflight/handshake.ts` — Phase 3: MCP connect + `whoami` call; yields `PreFlight.TokenRejected` (401), `PreFlight.GhostNotFound` (404/ghost not found); returns `GhostIdentity` on success
- [ ] T013 Create `ghosts/ghost-cli/src/diagnostics.ts` — `formatDiagnostic(e: PreFlightError): { message: string; remedy: string }` pure function covering all nine `PreFlightError` variants; `toExitCode(e: PreFlightError): 1 | 2 | 3` mapping per IC-005

**Checkpoint**: `pnpm --filter @aie-matrix/ghost-cli run typecheck` exits 0

---

## Phase 3: User Story 1 + 4 — One-Shot Commands & JSON Output (P1/P4) 🎯 MVP

**Goal**: All five MCP ghost tools exposed as one-shot CLI subcommands with human-readable
default output, `--json` for machine-parseable output, `--debug` for raw payloads on stderr,
typed exit codes, and pre-flight on every invocation.

**Independent Test**:
```bash
export GHOST_TOKEN=<token> WORLD_API_URL=http://127.0.0.1:8787/mcp
pnpm --filter @aie-matrix/ghost-cli start -- whoami         # exits 0, prose output
pnpm --filter @aie-matrix/ghost-cli start -- exits --json  # exits 0, valid JSON on stdout
unset GHOST_TOKEN
pnpm --filter @aie-matrix/ghost-cli start -- whoami         # exits 1, diagnostic on stderr
```

### Implementation for User Story 1 + 4

- [ ] T014 [US1] Create `ghosts/ghost-cli/src/oneshot/commands.ts` — Effect handler for each of the five MCP tool calls (`whoami`, `whereami`, `look`, `exits`, `go`); each handler runs `runPreflight`, calls `GhostClientService.callTool`, formats result as prose or JSON per `GhostConfig.json`; `go` result includes movement-denial codes rendered as game prose
- [ ] T015 [P] [US1] Create `ghosts/ghost-cli/src/cli.ts` — `@effect/cli` `Command` tree: root command with `--token`, `--url`, `--debug`, `--json` options; five subcommands (`whoami`, `whereami`, `look [here|around|<face>]`, `exits`, `go <face>`); non-TTY check gates the interactive path
- [ ] T016 [US1] Wire `ghosts/ghost-cli/src/index.ts` — `NodeRuntime.runMain(Command.run(rootCommand)(process.argv))` with `Layer.mergeAll(GhostClientLayer, GhostConfigLayer)` as the runtime; `toExitCode` maps pre-flight errors to exit codes before `NodeRuntime.runMain` sees them
- [ ] T017 [P] [US1] Implement `--debug` flag behaviour in `src/oneshot/commands.ts` — when `GhostConfig.debug` is true, emit raw MCP payload and `Effect.Cause` chain to stderr before returning
- [ ] T018 [P] [US1] Implement `--json` flag behaviour — when `GhostConfig.json` is true, write `JSON.stringify(rawMcpResult)` to stdout; when false, write formatted prose; stdout and stderr are strictly separated in all cases

### Tests for User Story 1 + 4

- [ ] T019 [P] [US1] Create `ghosts/ghost-cli/tests/preflight.test.ts` — unit tests for Phase 1 (`env-scan.ts`): token absent, URL absent, URL missing `/mcp` suffix, both present and valid; all tests run without network
- [ ] T020 [P] [US1] Create `ghosts/ghost-cli/tests/diagnostics.test.ts` — one assertion per `PreFlightError` variant: `formatDiagnostic` returns non-empty `message` and `remedy`; `toExitCode` returns correct code per IC-005
- [ ] T021 [P] [US1] Create `ghosts/ghost-cli/tests/command-parser.test.ts` — unit tests for `ReplCommand` parser (from `src/repl/repl-state.ts`, stub the type if REPL phase not yet done): each vocabulary word, invalid face direction → `unknown`, empty input → `unknown`

**Checkpoint**: All three smoke test commands above pass; `pnpm --filter @aie-matrix/ghost-cli run test` exits 0

---

## Phase 4: User Story 2 — Pre-Flight Diagnostic Completeness (P2)

**Goal**: All nine `PreFlightError` variants produce distinct, human-readable diagnostic
messages with a single concrete remediation step. A contributor who runs the CLI without
a token, a stopped server, an expired token, or a malformed URL gets the exact fix.

**Independent Test**:
```bash
# Server stopped, valid token:
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# stderr contains "pnpm run poc:server", exits 2

# Wrong URL format:
WORLD_API_URL=http://127.0.0.1:8787 pnpm --filter @aie-matrix/ghost-cli start -- whoami
# stderr contains "Try …/mcp", exits 1

# Expired token (restart server without re-adopting):
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# stderr contains "pnpm run poc:ghost", exits 3
```

### Implementation for User Story 2

- [ ] T022 [US2] Expand `ghosts/ghost-cli/src/preflight/reachability.ts` — distinguish: `ECONNREFUSED` on default port 8787 ("world server isn't running") vs non-default port ("nothing listening on `<host>:<port>`"), `ENOTFOUND` ("hostname can't be resolved"), 200 from server but 404 from `/mcp` endpoint ("server running but MCP path not found")
- [ ] T023 [US2] Expand `ghosts/ghost-cli/src/preflight/env-scan.ts` — `EnvMissingToken` with `inRepoRoot: true` produces repo-specific message; `EnvMissingToken` with `inRepoRoot: false` notes to `cd <repo>` first; `EnvMissingUrl` with `hasEnvFile: true` instructs adding `WORLD_API_URL` to `.env`
- [ ] T024 [US2] Expand `ghosts/ghost-cli/src/diagnostics.ts` — verify all nine `PreFlightError` variants have a `remedy` string that is a single shell command or a single file edit instruction (not a list of possibilities); add the `PreFlight.UnknownNetworkError` informative-blocking variant that states what was observed and directs to server logs
- [ ] T025 [P] [US2] Expand `ghosts/ghost-cli/tests/diagnostics.test.ts` — add assertions for the four new `reachability.ts` variants and the two expanded `env-scan.ts` variants; verify `remedy` is non-empty for all guided-resolution types; verify `remedy` is empty for `UnknownNetworkError`

**Checkpoint**: All three smoke tests above pass; `tests/diagnostics.test.ts` exits 0 with all nine variants covered

---

## Phase 5: User Story 3 — Interactive REPL (P3)

**Goal**: Launching `ghost-cli` with no subcommand opens a multi-panel Ink terminal UI with
live connection state, world view, ghost identity, exits, scrolling log, and readline input.
Commands typed in the REPL call MCP tools and update panels. The CLI reconnects automatically
after transient disconnects.

**Independent Test**:
```bash
pnpm --filter @aie-matrix/ghost-cli start
# Green ● CONNECTED strip; all panels populated
# type "look around" → World View updates
# type "go ne"       → Ghost + Exits panels update; Log records move
# type "exit"        → graceful disconnect, exits 0
```

### Implementation for User Story 3

- [ ] T026 [US3] Create `ghosts/ghost-cli/src/repl/repl-state.ts` — Effect `Ref` declarations for `connectionStateRef`, `identityRef`, `positionRef`, `tileViewRef`, `exitsRef`, `logRef`; `ReplCommand` discriminated union type and `parseReplCommand(input: string): ReplCommand` pure function
- [ ] T027 [P] [US3] Create `ghosts/ghost-cli/src/repl/StatusStrip.tsx` — Ink component reading `connectionStateRef` via a `useEffect`/polling adapter; renders color-coded strip with four states (Connected/Reconnecting/Disconnected/TokenExpired) per data-model.md
- [ ] T028 [P] [US3] Create `ghosts/ghost-cli/src/repl/WorldView.tsx` — renders `tileViewRef` prose; shows placeholder "looking…" before first `look here` result
- [ ] T029 [P] [US3] Create `ghosts/ghost-cli/src/repl/GhostPanel.tsx` — renders `identityRef` (ghostId) and `positionRef` (tileId, col, row); shows "—" before first `whereami` result
- [ ] T030 [P] [US3] Create `ghosts/ghost-cli/src/repl/ExitsPanel.tsx` — renders `exitsRef` exit list; shows "none" when empty
- [ ] T031 [P] [US3] Create `ghosts/ghost-cli/src/repl/LogPanel.tsx` — renders last N entries from `logRef` where N fits terminal height; windowed scrolling; never shows raw error traces
- [ ] T032 [P] [US3] Create `ghosts/ghost-cli/src/repl/InputBar.tsx` — Ink `TextInput` component; grays out with "(reconnecting…)" label while `connectionState` is not `Connected`; queues input during reconnect and replays on reconnect
- [ ] T033 [US3] Create `ghosts/ghost-cli/src/repl/App.tsx` — Ink root component composing all panels in the layout from RFC-0003 (status strip top, left/right split, log strip, input bar); receives all Refs as props; wires up MCP command dispatch loop
- [ ] T034 [US3] Implement REPL command dispatch in `src/repl/App.tsx` — on submit, `parseReplCommand` → dispatch to appropriate `GhostClientService.callTool` call → update relevant Refs → append `LogEntry`; after any `go` command, auto-call `look here` and `exits` to refresh panels; unknown command appends help text to log
- [ ] T035 [US3] Implement reconnect fiber in `src/cli.ts` interactive branch — Effect fiber watches `connectionStateRef`; on `NetworkError`, updates state to `Reconnecting`, retries with `Schedule.exponential("1 second").pipe(Schedule.upTo("30 seconds"))`; re-runs pre-flight phases 2+3 before resuming; sets `TokenExpired` state on `PreFlight.TokenRejected`
- [ ] T036 [US3] Wire interactive mode into `src/cli.ts` — when no subcommand and `process.stdout.isTTY` is true, render `<App>` via Ink `render()`; when `isTTY` is false, print one-line message and fall through to one-shot mode
- [ ] T037 [P] [US3] Update `ghosts/ghost-cli/tests/command-parser.test.ts` — finalize tests now that `parseReplCommand` is implemented: all vocabulary words, all face directions, `look around`, `exit`/`quit`, empty string, unknown input

**Checkpoint**: Interactive REPL smoke test passes; `pnpm --filter @aie-matrix/ghost-cli run test` exits 0

---

## Phase 6: Polish & Documentation (US documentation impact)

**Purpose**: Documentation updates and root alias. Resolves RFC-0003 open questions 1, 3, 5.

- [ ] T038 [P] Update `ghosts/README.md` — add `ghost-cli` row to packages table: `| [ghost-cli/](./ghost-cli/) | @aie-matrix/ghost-cli | Interactive REPL and one-shot CLI for human-operated ghost debugging. |`
- [ ] T039 [P] Update root `package.json` — add `"poc:cli": "pnpm --filter @aie-matrix/ghost-cli start"` to scripts (resolves RFC-0003 Q5)
- [ ] T040 [P] Update `docs/project-overview.md` — add `ghost-cli` under debugging / developer tools section noting one-shot and interactive REPL modes
- [ ] T041 [P] Update `specs/001-minimal-poc/quickstart.md` — add "Verify with ghost-cli" step after the ghost adoption step, referencing `pnpm run poc:cli whoami`
- [ ] T042 Run full quickstart.md validation: start server (`pnpm run poc:server`), adopt ghost (`pnpm run poc:ghost`), run each one-shot command, launch interactive REPL, confirm all steps from `specs/004-ghost-cli/quickstart.md` succeed
- [ ] T043 Run `pnpm typecheck` across all workspace packages and confirm exit 0
- [ ] T044 Run `pnpm --filter @aie-matrix/ghost-cli run test` and confirm all test suites pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Requires Phase 1 complete — **BLOCKS all user stories**
- **US1+US4 (Phase 3)**: Requires Phase 2 complete; delivers MVP
- **US2 (Phase 4)**: Requires Phase 2 complete; can start in parallel with Phase 3 if staffed
- **US3 (Phase 5)**: Requires Phase 3 complete (one-shot commands must exist before REPL can call them); also requires T026 from this phase for `ReplCommand` types referenced in T021
- **Polish (Phase 6)**: Requires Phase 5 complete

### User Story Dependencies

- **US1+US4 (P1/P4)**: Starts after Foundational — no dependency on US2 or US3
- **US2 (P2)**: Starts after Foundational — can overlap with US1/US4; expands code written in Phase 2
- **US3 (P3)**: Starts after US1/US4 — needs one-shot command handlers as building blocks for REPL dispatch

### Within Each Phase

- Setup: T001–T005 can run in any order; T006 depends on all of T001–T005
- Foundational: T007–T012 can run in parallel after T001; T013 depends on T010–T012
- Phase 3: T014 → T015 → T016 (service → CLI → wire); T017–T021 are parallel after T014
- Phase 4: T022–T024 expand existing files; T025 depends on T022–T024
- Phase 5: T026 first (types needed by all); T027–T033 parallel after T026; T034–T036 depend on T033; T037 depends on T026
- Phase 6: T038–T041 fully parallel; T042–T044 depend on all prior tasks

---

## Parallel Example: Phase 3 (US1+US4)

```bash
# After T013 is complete, launch in parallel:
Task T014: "Implement one-shot command handlers in src/oneshot/commands.ts"
Task T019: "Write preflight unit tests in tests/preflight.test.ts"
Task T020: "Write diagnostics unit tests in tests/diagnostics.test.ts"
# Then after T014:
Task T015: "Build @effect/cli Command tree in src/cli.ts"
Task T017: "Implement --debug flag in src/oneshot/commands.ts"
Task T018: "Implement --json flag in src/oneshot/commands.ts"
```

## Parallel Example: Phase 5 (US3)

```bash
# After T026 (repl-state.ts), launch all Ink components in parallel:
Task T027: "StatusStrip.tsx"
Task T028: "WorldView.tsx"
Task T029: "GhostPanel.tsx"
Task T030: "ExitsPanel.tsx"
Task T031: "LogPanel.tsx"
Task T032: "InputBar.tsx"
# Then after T027-T032:
Task T033: "App.tsx root component"
```

---

## Implementation Strategy

### MVP First (US1+US4 Only — Phases 1–3)

1. Phase 1: Scaffold the package
2. Phase 2: Build GhostClientService + pre-flight types
3. Phase 3: All five one-shot commands + tests
4. **STOP and VALIDATE**: `pnpm run poc:cli whoami` works; JSON flag works; missing token gives a message
5. This is already useful for spot-inspection and shell scripting

### Incremental Delivery

1. Phase 1 + 2 → Foundation (not user-visible, but required)
2. Phase 3 → One-shot CLI: **demonstrable MVP**
3. Phase 4 → Richer diagnostics: contributor self-rescue works reliably
4. Phase 5 → Interactive REPL: full text-adventure experience
5. Phase 6 → Documentation: onboarding-complete

### Suggested Task Scope for a Single Session

**Short session (2–3 hours)**: Phases 1–3 only (T001–T021) → MVP one-shot CLI
**Full session**: All phases → complete feature per RFC-0003

---

## Notes

- [P] tasks = different files, no inter-task dependencies within that phase
- [USN] label maps each task to its user story for traceability
- Each user story phase is independently testable via its smoke test
- Tests in Phase 3 cover pure logic (no live server needed) — run them first
- DCO sign-off required on all commits: `git commit -s`
- Confirm `pnpm typecheck` passes after each phase before proceeding
