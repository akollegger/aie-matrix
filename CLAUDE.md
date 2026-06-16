# aie-matrix

A hex-tile virtual world running alongside the AI Engineer World's Fair, where autonomous agents explore and compete as digital twins of IRL attendees.

## Active Technologies
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@effect/cli`, `@effect/platform-node`, `ink` (v5+), `react` (v18) (004-ghost-cli)
- None (stateless CLI; reads `.env` via `@aie-matrix/root-env`) (004-ghost-cli)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `h3-js` (new, all affected packages), `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3 (005-h3-coordinate-system)
- Neo4j (world graph — cell identity property changes to `h3Index`); in-memory Colyseus schema (005-h3-coordinate-system)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3, `h3-js` (existing), `ulid` (new — message IDs) (006-ghost-conversation)
- JSONL on disk (`{ghost_id}.jsonl` per thread); in-memory ghost state in `ConversationService` (006-ghost-conversation)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@a2a-js/sdk` per ADR-0004 / RFC-0007; minimal additional npm deps only where the SDK does not cover HTTP serving (spike-local choice — document in `research.md` if changed) (008-a2a-agent-host-spike)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@a2a-js/sdk` 0.3.13+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3, `ulid` (event IDs), `@aie-matrix/root-env` (shared env loading) (009-agent-host-a2a)
- File-backed JSON (`catalog.json`) for agent registration; in-memory `Map` for active agent sessions (009-agent-host-a2a)
- TypeScript 5.7 (browser target), React 18, Node.js 24 (build/dev only) + deck.gl ≥ 9 (H3HexagonLayer, PointCloudLayer, IconLayer), `h3-js` ≥ 4, `colyseus.js` (matches `@colyseus/core` 0.15.57), `@relateby/pattern` (gram parsing, per IC-002 consumer note in spec-010), `@aie-matrix/shared-types` (existing workspace package) (011-intermedium-client) — **full-bleed** H3 scene; **overlay** panels; interiority = inventory / **goals** / **memories** (observability copy, not RPG-quest; RFC-0008)
- None — stateless client; reads from Colyseus (live positions), HTTP (map topology at startup), A2A (conversation stream) (011-intermedium-client)
- TypeScript 5.7 (browser target, ESM) + React 18, Vite 6, MapLibre GL 5 (base map), h3-js 4 (cell math), `@relateby/pattern` (gram import parsing) (012-h3geojson-map-editor)
- Browser memory only (MVP); files exchanged via browser download/upload (012-h3geojson-map-editor)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@relateby/pattern` (Gram AST), `h3-js` 4 (polygon fill, cell math), `effect` v3+ (async plumbing), `@colyseus/core` 0.15.57 (consumer), `vitest` (tests) (013-gram-format-migration)
- File-based — `.map.gram` files in `maps/`; no database (013-gram-format-migration)
- TypeScript 5.7 (browser target, ESM) + React 18, deck.gl ≥ 9 (`H3HexagonLayer`, `ScatterplotLayer`, `_GlobeView`), h3-js ≥ 4, colyseus.js, `@react-three/fiber`, `three`, Vite 6 (014-intermedium-polish)
- N/A — stateless browser client (014-intermedium-polish)
- TypeScript 5.7 / Node.js 24, ESM (`"type": "module"`) + `effect` v3+, `neo4j-driver` v5, `@google-cloud/storage` v7 (new), `busboy` v1 (new — multipart parsing), `ioredis` v5 (new — world-api pub/sub), `ulid` (new — session IDs), `zod` v3 (015-map-management)
- Neo4j (`:Map`, `:LiveSession`, `:Cell` nodes); GCS (`.map.gram` artifact blobs) (015-map-management)
- TypeScript 5.7 / Node.js 24 (ESM `"type": "module"`); pnpm 10 workspace monorepo + Effect v3+, `@colyseus/core` 0.15.57, Docker Compose v2, GitHub Actions (016-staging-deployment)
- Neo4j 5 container (named volume for persistence), Redis 7 container (016-staging-deployment)
- Bash (CI steps); gcloud CLI (infrastructure provisioning) + GCS (static hosting), Cloud Load Balancer (GCLB), Cloud CDN, Identity-Aware Proxy (IAP), GitHub Actions (017-frontend-deploy-auth)
- Two GCS buckets — `gs://aie-matrix-intermedium` (public), `gs://aie-matrix-admin` (private) (017-frontend-deploy-auth)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `express` v4, `@a2a-js/sdk` 0.3.13+, `@aie-matrix/root-env`, `@aie-matrix/ghost-ts-client` (workspace); Docker/Podman multi-stage build; Kubernetes 1.28+ (018-ghost-agent-deployment)
- `catalog.json` on agent-host (no new storage owned by ghost) (018-ghost-agent-deployment)
- TypeScript 5.7 (browser target, ESM) / React 18 / Vite 6 + React 18, Vite 6, `unique-names-generator` (new), existing `mapServer.ts` service pattern (019-ghost-management)
- Browser memory only — no persistence across page loads (019-ghost-management)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@relateby/pattern` (gram AST), `h3-js` ≥ 4 (H3 cell math), `@colyseus/core` 0.15.57, `vitest` (tests) (020-map-catalog-standardization)
- Files — `.map.gram` in `maps/`; GCS in staging/production (not touched by this feature) (020-map-catalog-standardization)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@relateby/pattern` (Gram AST), `neo4j-driver` v5, `@aie-matrix/shared-types`, `@aie-matrix/map-gram` (021-world-calendar)
- Neo4j (`:CalendarEvent` nodes with `started`/`ended` markers); `.calendar.gram` files on disk (021-world-calendar)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `neo4j-driver` v5, `@relateby/pattern` (gram AST), `ulid`, `node:crypto` (SHA-256, no new dep) (022-in-world-resource-ledger)
- Neo4j (`(:LedgerEntry)` nodes in session subgraph); in-memory `Map` bag caches (022-in-world-resource-ledger)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `neo4j-driver` v5, `ulid`, `unique-names-generator` (new dep in `server/world-api`) (023-group-formation)
- Neo4j (`(:Group)` nodes, `MEMBER_OF`/`PARTICIPANT_IN`/`OWNS` edges in session subgraph); JSONL on disk (`{group_id}.jsonl` group chat threads in `CONVERSATION_DATA_DIR`); in-memory `Map` caches for group state and vote windows (023-group-formation)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `neo4j-driver` v5, `@modelcontextprotocol/sdk` 1.29+, `ulid`, `zod` 3 — all already in `server/world-api` (024-eval-contracts)
- Neo4j (`(:EvalContract)` nodes); in-memory `Map` for unit tests (024-eval-contracts)
- TypeScript 5.7 / Node.js 24 (ESM `"type": "module"`) + `effect` v3+, `neo4j-driver` v5, `@modelcontextprotocol/sdk` 1.29+, `@relateby/pattern` (gram AST), `zod` v3, `ulid` — all already present in `server/world-api` (026-session-leaderboards)
- Neo4j (`(:LeaderboardSnapshot)` nodes in session subgraph); in-memory TTL cache for live rankings (026-session-leaderboards)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@a2a-js/sdk` 0.3.13+, `@modelcontextprotocol/sdk` 1.29+, `@aie-matrix/ghost-ts-client` (workspace), `@aie-matrix/root-env` (workspace), `@relateby/pattern` ^0.4.2 (catalog gram parsing — pin matches `shared/map-gram`), `express` ^4.21, `h3-js` ^4.1, `effect` v3+ (server-side service layers), `ulid` (028-npc-agent)
- `.character.gram` files on disk under `NPC_CATALOG_DIR` (catalog); in-memory `Map` per-character/per-partner dialog state; Neo4j-backed registry gains a per-ghost `background` property (additive) (028-npc-agent)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@a2a-js/sdk` 0.3.13+, `@aie-matrix/ghost-ts-client` (workspace), `@relateby/pattern` ^0.4.2 (029-funder-into-npc)
- In-memory `Map` (per-ghost funder state); no new persistence (029-funder-into-npc)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) — server; TypeScript 5.7 (browser target, ESM) — client + `effect` v3+, `@modelcontextprotocol/sdk` 1.29+, `@colyseus/core` 0.15.57, `colyseus.js` (client), `jsonwebtoken`, `@relateby/pattern`, React 18, Vite 6 (030-human-ghost-peer)
- No new storage; uses existing Neo4j ledger (via LedgerService) and in-memory Colyseus room state (030-human-ghost-peer)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `express` v4, `@a2a-js/sdk` 0.3.13+ (032-ghost-autospawn)
- None (no new persistence; catalog.json is existing) (032-ghost-autospawn)

TypeScript 5.7 / Node.js 24, pnpm 10 workspace monorepo. Key packages: `effect` v3+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3.

## Commands

```bash
pnpm install          # install all workspace deps
pnpm dev              # run combined server in watch mode
pnpm test             # package unit tests (no Playwright; no ghost-tck — needs live server)
pnpm test:e2e         # Playwright end-to-end
pnpm test:tck         # ghost contract tests (server must be running)
pnpm typecheck        # TypeScript across all packages
pnpm run lint
```

## Documentation

### Project context
- `docs/project-overview.md` — product vision, ghost mechanics, contribution areas
- `docs/architecture.md` — decided stack, Effect-ts orchestration layer, open questions

### Technical guides (read before writing code in that area)
- `docs/guides/effect-ts.md` — Effect service/Layer patterns, typed errors, ManagedRuntime wiring, request tracing

### Decision records
- `proposals/adr/0002-adopt-effect-ts.md` — why Effect-ts, migration phases, trade-offs
- `proposals/adr/README.md` — ADR format and process

### Feature specifications
- `specs/002-effect-ts-transition/` — current branch spec, plan, tasks, contracts, quickstart

## Contribution process

See `CONTRIBUTING.md` for workflow (branches, PRs, DCO sign-off).  
See `AGENTS.md` for agent-specific guidance on navigating and contributing to this repo.

## Key conventions

- All server dependencies are injected via Effect `Context.Tag` / `Layer`. No globals, no `if (!service)` guards.
- All domain failures use `Data.TaggedError`. Errors reaching HTTP must be covered in `server/src/errors.ts:errorToResponse()` with `Match.exhaustive`.
- DCO sign-off required: `git commit -s`
- Non-trivial work starts with an RFC or ADR before implementation.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

## Recent Changes
- 032-ghost-autospawn: Ghost agents now auto-spawn into active sessions without manual intervention. `random-agent` exposes `GET /v1/roster` returning N synthetic wanderer entries (controlled by `RANDOM_AGENT_COUNT` env var, default 10) and declares `rosterAgent: true` in its agent card, plugging into the existing `spawnRosterForAgent` path used by npc-agent. `agent-host` startup now runs a reconciliation pass: if a live session is already active on startup (e.g. after a pod restart), it calls `spawnRosterForAgent` for every `rosterAgent: true` catalog entry. Set `AGENT_HOST_DISABLE_RECONCILIATION=1` to opt out.
- 030-human-ghost-peer: Intermedium browser client is now a first-class ghost peer. `POST /auth/guest` issues a guest JWT with `role: "human"`. Human callers skip proximity check for directed `say()`. NPC ghosts call `ghost_announce` MCP tool on connect to populate `ghostLabels` in Colyseus room state (used to badge brokers in the ghost list). Client-side: `useIdentity` hook persists ghostId + displayName in localStorage; `BalanceDisplay` shows broker-credit balance; `useContracts` polls for active contracts and renders an inline submission form in `ChatPanel`; leaderboard highlights the human's own entry.
- 029-funder-into-npc: Migrated funder character into npc-agent as `behaviorKind: "broker"`, dispatched via gram label `Character:Broker`. `funder-agent` container removed from `deploy/staging/docker-compose.yml`. New `broker-behavior.ts` module holds per-ghost state machine; behavior kind is derived from secondary gram labels (not a property field); `broker.character.gram` added to npc-agent catalog.
