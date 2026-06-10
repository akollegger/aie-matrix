# Phase 0 Research: NPC Agent

All NEEDS CLARIFICATION items from Technical Context are resolved below. Evidence is from the existing codebase (file:line references).

## R1 — Agent-initiated roster spawn (resolves IC-006/IC-007)

**Decision**: Add a new agent-callable spawn endpoint to the agent-host and emit `world.session.start` from the world server.

**Rationale**: Investigation confirmed the clarified "self-spawn on session.start" path does not exist today:
- `POST /v1/sessions/spawn/:agentId` ([server/agent-host/src/app.ts:434](../../server/agent-host/src/app.ts)) is guarded by the host **dev token** (`requireBearer`) and is called only by external orchestrators (`scripts/demo.mjs:337`, `ghosts/tck/src/social.ts:118`, `tools/map-editor/.../agentHostClient.ts`). Agents do not hold that token.
- `world.session.start` is in `WorldEventKind` ([server/agent-host/src/types.ts:117](../../server/agent-host/src/types.ts)) and mapped in `colyseus-bridge/translate-world-v1.ts:18`, but **no code ever broadcasts a `world-v1` fanout with `t:"session.start"`** — only `message.new`, `contract.submitted`, `leaderboard.updated` are emitted.
- The spawn engine itself (`AgentSupervisor.spawn`, [SupervisorService.ts:331](../../server/agent-host/src/supervisor/SupervisorService.ts)) is reusable: it rejects duplicate `ghostId`, resolves world entry H3 via MCP `whereami`, mints `mcpToken`/`sessionId`, builds the `SpawnContext`, and delivers over A2A.

**Design**: 
- World server emits a `session.start` fanout when a live session begins (same `fanoutWorldV1` → `room.broadcast("world-v1", …)` path used by `message.new` at `server/src/index.ts:441`). The host bridge already translates it (`translate-world-v1.ts:18`) and `deliverWorldEvent` forwards to A2A-push agents.
- A new host route (e.g. `POST /v1/sessions/spawn-roster/:agentId`) accepts a roster `[{ characterId, displayName, background }]` from an **authenticated agent** and internally loops `AgentSupervisor.spawn` per character. Auth: see R2.

**Alternatives considered**: External orchestrator only (no host change) — rejected by stakeholder (demotes the capability to a script). Host spawns N npc-agent instances — contradicts "one top-level agent spawns the roster."

## R2 — Scoped auth for the agent-callable spawn endpoint (resolves Constitution Principle V)

**Decision (recommended)**: Authenticate the calling agent with the **session credential it already received in its own `SpawnContext`** (the `mcpToken`/session token minted by the host at spawn). The host validates the token against its existing session/token maps (registered before delivery at `SupervisorService.ts:426`) and authorizes roster-spawn for that agent identity. No new credential type, no bare shared secret.

**Rationale**: Reuses the existing scoped-credential system (Principle V); the host already tracks agent sessions and tokens. The top-level npc-agent must itself be spawned once (bootstrap) to obtain a session credential — see R3.

**Open for ADR**: If validation shows the existing session token cannot cleanly authorize a *fan-out* spawn (e.g. it is scoped to a single ghost's world calls, not host control), a dedicated capability grant is needed — which **would require a companion ADR** (RFC-0026 OQ#1, Complexity Tracking). Confirm during contract implementation.

## R3 — Bootstrap & restart idempotency (resolves spawn lifecycle)

**Decision**: The npc-agent is itself registered + spawned once as a "coordinator" ghost (via the existing host flow). On `world.session.start`, the coordinator calls the roster-spawn endpoint for all enabled characters. Each character ghost is a distinct host session; the executor embodies one character per `SpawnContext` (matched by `characterId` carried in the spawn context or by `displayName`).

**Session discovery** (per ADR-0012): on startup the coordinator queries the existing world-api `GET /live?status=active` ([LiveSessionRoutes.ts:228](../../server/world-api/src/live/LiveSessionRoutes.ts), accepts `?status=active` at `:231`, returns `SessionRecord[]`). If a session is active it spawns immediately; if the list is empty it awaits `world.session.start` (R1) rather than polling. No new discovery endpoint is added — this is the same list the Intermedium client uses.

**Restart**: Reuse the host's existing duplicate-`ghostId` rejection ([SupervisorService.ts:333](../../server/agent-host/src/supervisor/SupervisorService.ts)). Roster spawn is idempotent by deriving a deterministic `ghostId` per `(session, characterId)` so a restart re-requests the same ids; already-active sessions are rejected (no duplicate) and the agent re-attaches via the existing spawn-context delivery. (US1 scenario 3.)

**Alternatives**: Persisting dialog/loop state across restart — rejected; dialog state is in-memory and resets on restart (consistent with "no persistent character memory across sessions", spec Out of Scope). A missed early greeting is acceptable (spec edge case).

## R4 — `.character.gram` format & parsing (resolves IC-001)

**Decision**: Author characters in gram via `@relateby/pattern` ^0.4.2 (matches `shared/map-gram`), using `parseWithHeader` for a `{ kind: "matrix-character", … }` header. Model behavior rules as an ordered `[behaviors:Behaviors | (rN:Rule {…})]` block and the dialog tree as labeled `(:DialogNode {…})` nodes connected by `[dialog:DialogTree | (a)-[:ON]->(b)]` relationships.

**Rationale**: Mirrors established repo idioms — `shared/map-gram/src/parse.ts` (typed property readers `strProp`/`intProp`/`getStringArray`, label dispatch, block-child iteration), `server/world-api/src/calendar/parse-calendar-gram.ts` (strict Effect validation, duplicate-id detection via `seenIds`, accumulate-missing-fields), and `server/world-api/src/rules/rule-graph.ts` (relationship detection via `elements.length === 2`, first-labelled-occurrence back-reference resolution — exactly how a dialog node defined once is referenced by bare id later). `trigger`/`responses` are `ArrayVal` of strings.

**Validation style**: calendar-parser pattern — per-entry: require non-empty `identity`, detect duplicate ids, accumulate missing required fields into one error, validate enums (`defaultAction`), then **skip the entry with a warning** and continue loading the valid subset (FR-014). `MapVal` nested records are avoided (no existing parser reads them).

**Alternatives**: JSON/YAML — rejected for inconsistency with project tooling. `MapVal` nesting — rejected (net-new reader).

## R5 — Catalog parser package home (resolves Open Question)

**Decision**: Package-local module `ghosts/npc-agent/src/catalog/parse-character-gram.ts`, not a new `shared/` package.

**Rationale**: The catalog is consumed only by the npc-agent (the client/world never reads characters), mirroring the calendar/leaderboard parsers which live inside `server/world-api/src/` rather than a shared package. Promote to `shared/character-gram` only if a second consumer appears.

## R6 — Per-ghost background (resolves IC-008)

**Decision**: Add an optional `background` string to the registry adoption payload and `SpawnContext.ghostCard`.

**Rationale**: Today only `displayName` is per-ghost ([registry/src/routes/adoption.ts:101](../../server/registry/src/routes/adoption.ts)); a ghost's `about` is per-*agent* in the AgentCard (`buildAgentCard.ts:31`) and cannot distinguish characters sharing one agent. `displayName` already flows adopt → `SpawnContext.ghostCard.displayName` ([SupervisorService.ts:378](../../server/agent-host/src/supervisor/SupervisorService.ts)); `background` follows the same additive path. (US1 scenario 2.)

## R7 — Package structure & deployment (resolves scaffolding)

**Decision**: Mirror `ghosts/random-agent/` (fuller template with tests/README) rather than `funder-agent` (no tests). Port `4004` (4001 random, 4002 funder, 4003 used by tck echo-agent). Add the package to root `package.json` `test:packages` filter and `pnpm-workspace.yaml`. Dockerfile mirrors random-agent's 3-stage build (add `@relateby/pattern` to the topological build order). Staging compose service block + `NPC_CATALOG_DIR` + catalog volume; k8s optional (funder-agent precedent: compose-only is acceptable).

**Rationale**: Direct evidence from `ghosts/random-agent/` and `ghosts/funder-agent/` package layouts; deploy precedent in `deploy/staging/docker-compose.yml:118-156`.

## R8 — Integration test harness (resolves FR-015/SC-007/SC-008)

**Decision**: Add `ghosts/tck/src/npc.ts` mirroring `social.ts`: validate agent card → register → create caretaker+house → adopt external ghost(s) → spawn → inject `world.message.new` via `/internal/world-fanout` (gated on `AIE_MATRIX_INTERNAL_FANOUT_TOKEN`) → assert the NPC's `say` reply via a `_tck/dialog` introspection endpoint on the npc-agent and/or the `/threads/:ghostId` conversation log. The two-ghost interleaved test (SC-008) adopts two external ghosts and asserts each conversation independently.

**Rationale**: `social.ts` is an almost-exact existing harness for "external ghost drives an agent, assert reply." Note: npc-agent must expose a `_tck/dialog` introspection hook (random/funder agents don't have one) — small addition for test observability.

**Alternatives**: vitest-only against mocked MCP — used for unit isolation (per-partner state, FR-012), but cannot prove end-to-end delivery; both tiers are needed.
