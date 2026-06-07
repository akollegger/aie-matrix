# Implementation Plan: Session Leaderboards

**Branch**: `026-session-leaderboards` | **Date**: 2026-06-06 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/026-session-leaderboards/spec.md`

## Summary

Add a spectator-facing leaderboard mechanism that aggregates ledger entries into ranked actor lists. Maps declare leaderboard query parameters in a `[leaderboards:Leaderboards | ...]` gram block; a new `LeaderboardService` in `server/world-api` computes and TTL-caches rankings, freezes final snapshots on `finalize-leaderboards`, and exposes results via two new unauthenticated MCP tools. Intermedium renders the rankings as an overlay panel that updates via A2A push. The map editor displays leaderboard definitions read-only.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `neo4j-driver` v5, `@modelcontextprotocol/sdk` 1.29+, `@relateby/pattern` (gram AST), `zod` v3, `ulid` — all already present in `server/world-api`  
**Storage**: Neo4j (`(:LeaderboardSnapshot)` nodes in session subgraph); in-memory TTL cache for live rankings  
**Testing**: `vitest` (unit tests against in-memory implementation); Neo4j integration tests (same skip-if-no-env pattern as `LedgerService`)  
**Target Platform**: Linux server (world-api) + browser (Intermedium, map-editor)  
**Project Type**: server service + MCP tool surface + browser overlay component  
**Performance Goals**: Rankings fresh within configurable TTL (default ~same order as `CALENDAR_TICK_MS`); no per-request query  
**Constraints**: No new auth path — leaderboard reads are unauthenticated; `finalize-leaderboards` uses existing scheduler/admin role check  
**Scale/Scope**: Conference scale (~hundreds of concurrent spectators); bounded by TTL cache

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| Proposal linkage | PASS | RFC-0025 is the authoritative proposal; spec traces directly to it |
| Architectural boundaries | PASS | New `LeaderboardService` follows existing `GroupService`/`EvalContractService` Layer/Tag pattern; no new top-level directories |
| Shared interface contracts | PASS | `LeaderboardSpec`, `LeaderboardEntry`, `LeaderboardResult` in `shared/types/`; `world.leaderboard.updated` A2A event extending existing `WorldEventKind` |
| Verifiable increments | PASS | 4 independent user slices; demo scenario in RFC-0025 defines end-to-end smoke test; quickstart documents local run |
| Documentation impact | PASS | `docs/architecture.md`, demo `.map.gram`, RFC-0025 status enumerated in spec |
| MCP/A2A-first | PASS | All domain operations via MCP tools (`leaderboards`, `leaderboard`); push delivery via A2A `world.leaderboard.updated`; no bespoke HTTP |
| Service testing | PASS | `LeaderboardServiceInMemory` unit tests required in same change; Neo4j integration tests planned in same change, may land separately if CI container unavailable |
| Build gate | REQUIRED | `pnpm run build` must pass before PR |

## Project Structure

### Documentation (this feature)

```text
specs/026-session-leaderboards/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── leaderboard-mcp-tools.md
│   ├── world-leaderboard-updated-event.md
│   └── leaderboard-gram-syntax.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code

```text
shared/types/src/
└── leaderboard.ts               # New: LeaderboardSpec, LeaderboardEntry, LeaderboardResult

server/world-api/src/
├── LeaderboardService.ts        # New: Context.Tag + interface (LeaderboardServiceOps)
├── LeaderboardServiceLive.ts    # New: Neo4j-backed Layer — aggregate queries, snapshot persistence
├── LeaderboardServiceInMemory.ts # New: In-memory Layer for unit tests
├── leaderboard-errors.ts        # New: typed Data.TaggedError types
├── mcp-server.ts                # Modified: add leaderboards + leaderboard tools; finalize-leaderboards command
├── calendar/
│   └── CalendarCommandDispatcher.ts  # Modified: register finalize-leaderboards command handler

maps/sandbox/
└── canonical.map.gram           # Modified: add [leaderboards:Leaderboards | ...] block + ghost system prompt

clients/intermedium/src/
├── components/LeaderboardPanel/
│   ├── LeaderboardPanel.tsx     # New: ranked table panel + "Session Complete" state
│   └── LeaderboardEntry.tsx     # New: single rank row
├── hooks/
│   └── useLeaderboard.ts        # New: subscribe to world.leaderboard.updated A2A events

tools/map-editor/src/
├── io/import-gram.ts            # Modified: parse [leaderboards:Leaderboards | ...] block
├── panels/detail/
│   └── LeaderboardDefinitionCard.tsx  # New: read-only display of one Leaderboard node
└── types/map-gram.ts            # Modified: add LeaderboardSpec to MapGram types
```

**Structure Decision**: No new top-level directories. `LeaderboardService` follows the three-file pattern (interface + live + in-memory) already established by `GroupService`, `EvalContractService`, and `LedgerService`. Shared types extend the existing `shared/types/src/` domain file pattern.

## Complexity Tracking

No constitution violations.
