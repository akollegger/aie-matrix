# Implementation Plan: Intermedium — Human Spectator Client

**Branch**: `011-intermedium-client` | **Date**: 2026-04-26 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/011-intermedium-client/spec.md`

## Summary

Build `clients/intermedium/` — a React SPA that serves as the human-facing observability interface to the ghost world. The client renders H3 hex geometry and ghost point-clouds via deck.gl, subscribes to live ghost positions via Colyseus, fetches world topology over HTTP, and hosts a paired-ghost conversation panel driven by the ghost house A2A stream. Navigation between five discrete zoom scales (Map → Area → Neighbor → Partner → Ghost) exposes the multi-agent observability hierarchy at AIEWF 2026. The existing Phaser client is mechanically renamed from `client/` to `clients/debugger/` with no internal changes.

## Technical Context

**Language/Version**: TypeScript 5.7 (browser target), React 18, Node.js 24 (build/dev only)  
**Primary Dependencies**: deck.gl ≥ 9 (H3HexagonLayer, PointCloudLayer, IconLayer), `h3-js` ≥ 4, `colyseus.js` (matches `@colyseus/core` 0.15.57), `@relateby/pattern` (gram parsing, per IC-002 consumer note in spec-010), `@aie-matrix/shared-types` (existing workspace package)  
**Storage**: None — stateless client; reads from Colyseus (live positions), HTTP (map topology at startup), A2A (conversation stream)  
**Testing**: Vitest (unit/component), Playwright (e2e — existing `pnpm test:e2e` harness)  
**Target Platform**: Modern desktop/tablet browsers (Chrome, Firefox, Safari current)  
**Project Type**: Web application (React SPA built with Vite 5+)  
**Performance Goals**: Ghost positions refresh <1 s; map renders and is interactive <3 s on conference Wi-Fi  
**Constraints**: No mobile layout for MVP; instant scale transitions (no animation); no MCP client dependency; `clients/debugger/` must remain fully functional after rename  
**Scale/Scope**: ~500–1 000 concurrent spectators; one paired ghost per attendee; ~500 ghosts on the world

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| Proposal linkage (`proposals/rfc/…` or `proposals/adr/…`) | ✅ | RFC-0008 covers full scope; ADR-0005 covers map format; ADR-0004 covers A2A protocol role |
| Planned structure preserves documented architectural boundaries | ✅ | New `clients/intermedium/` package; `client/` → `clients/debugger/` is mechanical rename with no internal changes |
| Shared interfaces have contract artifacts planned under `contracts/` | ⚠️ | IC-001 (Colyseus) and HTTP map endpoint (IC-002 in spec-010) are defined; IC-002 (A2A conversation) and IC-003 (ghost interiority) are gap contracts pending ghost house team |
| Verification covers each user slice; runnable code includes smoke test and local run instructions | ✅ | 4 user stories define independent acceptance scenarios; quickstart.md documents local run |
| Documentation impact enumerated for affected files | ✅ | Listed in spec: `docs/architecture.md`, `docs/project-overview.md`, `clients/debugger/README.md`, `clients/intermedium/README.md`, `CONTRIBUTING.md` |

**Gate result: PASS** — the two gap contracts (IC-002, IC-003) are acknowledged open questions from RFC-0008 §Open Questions 2 and 4. Ghost scale and A2A conversation panel are explicitly scoped as placeholder/stub in MVP.

## Project Structure

### Documentation (this feature)

```text
specs/011-intermedium-client/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── ic-001-colyseus-ghost-positions.md
│   ├── ic-002-a2a-conversation-subscription.md
│   └── ic-003-ghost-interiority-api.md
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
clients/                         # renamed from client/
  debugger/                      # formerly client/ — Phaser dev tool, no internal changes
  intermedium/                   # new React SPA (this feature)
    src/
      hooks/
        useViewState.ts          # { scale, focus } navigation state machine
        useColyseus.ts           # Colyseus connection + ghostTiles subscription
        useMapGram.ts            # map topology fetch + gram parse
        useA2AConversation.ts    # A2A conversation stream (stub until IC-002 resolved)
      components/
        SceneView/               # deck.gl canvas + layer composition
        PanelView/               # scale-dependent panel switcher
        GhostCard/               # ghost identity + proximity info
        ConversationThread/      # paired ghost conversation (read + send)
        GhostInteriority/        # inventory, quest, memory log (stub)
      layers/
        hexGridLayer.ts          # H3HexagonLayer configuration
        ghostPointCloudLayer.ts  # PointCloudLayer configuration
        tileIconLayer.ts         # IconLayer configuration
      services/
        colyseusClient.ts        # singleton Colyseus room client
        gramParser.ts            # .map.gram → WorldTile[]
        a2aClient.ts             # A2A conversation HTTP wrapper (stub)
      types/
        viewState.ts
        worldTile.ts
        ghostPosition.ts
        conversation.ts
      App.tsx
      main.tsx
    public/
    index.html
    vite.config.ts
    package.json
    tsconfig.json
    README.md

shared/types/                    # existing — no changes; intermedium consumes as workspace dep
```

**Structure Decision**: Web application layout (no backend component). The intermedium is a standalone Vite project under `clients/intermedium/` — consistent with the debugger's position under `clients/debugger/`. No framework code is shared between clients; shared workspace types are consumed as a package dependency per RFC-0008 §Repository Structure.

## Complexity Tracking

No constitution violations. No complexity justification required.

---

## Phase 0: Research

See [research.md](research.md) for findings. Key decisions resolved:

1. **deck.gl H3 integration** — H3HexagonLayer accepts H3 index strings natively; no coordinate conversion path needed. PointCloudLayer positioned at `h3.cellToLatLng()` centroid per ghost. Running deck.gl without a MapView (standalone OrthographicView or a flat MapView with no basemap tiles) keeps the void aesthetic.
2. **Colyseus JS client** — `colyseus.js` matches `@colyseus/core` 0.15.57 already in the monorepo. The intermedium joins the same Colyseus room the debugger uses; it reads `ghostTiles` (H3 index strings) and ignores `tileCoords`.
3. **Gram parsing** — `@relateby/pattern` is already listed as a downstream consumer in IC-002 (spec-010). The gram document is fetched once at startup and parsed into a `WorldTile[]` map keyed by H3 index.
4. **A2A conversation** — No stable non-agent consumer API exists yet. MVP stubs the conversation panel with a polling HTTP fallback against the ghost house `/conversation/:ghostId` route (if implemented) or renders a "conversation unavailable" placeholder. IC-002 documents the gap and the expected contract shape.
5. **Ghost interiority** — Fully stubbed for MVP; IC-003 documents the placeholder and expected ghost house read API shape.
6. **Rename `client/` → `clients/`** — Mechanical shell rename; all internal paths within the Phaser client are relative and do not reference the top-level directory name. The pnpm workspace `packages` glob in `pnpm-workspace.yaml` must be updated from `client/**` to `clients/**`.

---

## Phase 1: Design

See [data-model.md](data-model.md) for entity definitions.

See [contracts/](contracts/) for interface contracts:
- `ic-001-colyseus-ghost-positions.md` — intermedium's Colyseus consumption (references IC-008 from spec-005)
- `ic-002-a2a-conversation-subscription.md` — gap contract for human-side A2A conversation
- `ic-003-ghost-interiority-api.md` — placeholder contract for ghost interiority read API

The HTTP map API is fully specified in `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md`; the intermedium is already listed as a downstream consumer of `?format=gram` in that contract. No new contract needed.

See [quickstart.md](quickstart.md) for local developer setup.

### Post-design Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Proposal linkage | ✅ | Unchanged |
| Boundary-preserving design | ✅ | `clients/intermedium/` is a fully isolated SPA; no cross-client shared code |
| Contract artifacts | ✅ | 3 contracts in `contracts/`; HTTP map references existing spec-010 artifact |
| Verifiable increments | ✅ | Quickstart documents `pnpm dev` for local run; each user story has independent acceptance test path |
| Documentation impact | ✅ | All five documentation targets listed in spec are addressed in tasks |
