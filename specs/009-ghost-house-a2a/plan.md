# Implementation Plan: Ghost House A2A Coordination

**Branch**: `009-ghost-house-a2a` | **Date**: 2026-04-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-ghost-house-a2a/spec.md`

## Summary

Build the canonical ghost house service — A2A host, MCP proxy, Colyseus bridge, agent supervisor, and catalog — so third-party ghost agents can be registered, spawned, supervised, and fed world events. Delivered in three independent phases: Phase 1 (Wanderer: catalog + supervisor + MCP proxy + `random-agent` reference), Phase 2 (Listener: Colyseus bridge inbound + push events), Phase 3 (Social: Colyseus bridge outbound + `say` routing). ADR-0004 and RFC-0007 are the authority; this plan elaborates the RFC phased delivery into concrete packages, interfaces, and verification steps.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `@a2a-js/sdk` 0.3.13+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3, `ulid` (event IDs), `@aie-matrix/root-env` (shared env loading)  
**Storage**: File-backed JSON (`catalog.json`) for agent registration; in-memory `Map` for active agent sessions  
**Testing**: `ghosts/tck/` (TCK tier suites added per phase), `vitest` unit tests per package, smoke test in `quickstart.md`  
**Target Platform**: Node.js 24, macOS/Linux; localhost Phase 1, public HTTPS Phase 2+  
**Project Type**: Service (`ghosts/ghost-house/`) + Agent library (`ghosts/random-agent/`)  
**Performance Goals**: Event delivery latency tuned empirically (target: human-perceptible responsiveness); rate limits tuned empirically  
**Constraints**: `GHOST_HOUSE_DEV_TOKEN` static bearer — localhost Phase 1 only; auth ADR gates any non-local deployment; A2A protocol v0.3.0 for this feature (v1.0 upgrade tracked separately)  
**Scale/Scope**: AIEWF 2026 weekend event; hundreds of concurrent ghost agents; single ghost house instance (no federation)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Proposal linkage**: ADR-0004 and RFC-0007 are the primary authorities; scope matches RFC-0007 phased delivery exactly. ✓
- **Boundary preservation**: `ghosts/ghost-house/` and `ghosts/random-agent/` are new packages in the existing `ghosts/` convention. Existing `server/` packages are not modified. The Colyseus bridge is internal to the ghost house; the world-api package is consumed read-only. ✓
- **Contract artifacts**: IC-001 through IC-006 defined in `specs/009-ghost-house-a2a/contracts/`; each crosses a package or process boundary. ✓
- **Verifiable increments**: Each phase produces a working system. Phase 1 = `random-agent` passes Wanderer TCK. Phase 2 = `observer-agent` receives events and passes Listener TCK. Phase 3 = Social TCK with first contributed agent. ✓
- **Documentation impact**: RFC-0007 open questions resolved and updated per IC findings; `docs/architecture.md` component map updated; `CONTRIBUTING.md` and `ghosts/README.md` updated; `CLAUDE.md` updated with new packages. ✓

**Post-design re-check**: All five gates pass. No complexity violations.

## Project Structure

### Documentation (this feature)

```text
specs/009-ghost-house-a2a/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-001-agent-card-schema.md
│   ├── ic-002-a2a-protocol.md
│   ├── ic-003-mcp-tool-set.md
│   ├── ic-004-world-event-envelope.md
│   ├── ic-005-catalog-api.md
│   └── ic-006-spawn-context.md
└── tasks.md             # /speckit.tasks output (not created by this command)
```

### Source Code (repository root)

```text
ghosts/
├── ghost-house/                      # New: canonical ghost house service
│   ├── src/
│   │   ├── catalog/
│   │   │   ├── CatalogService.ts     # Effect service: CRUD + tier validation
│   │   │   └── catalog.layer.ts      # Layer providing CatalogService
│   │   ├── supervisor/
│   │   │   ├── SupervisorService.ts  # Effect service: spawn/health/restart/shutdown
│   │   │   └── supervisor.layer.ts
│   │   ├── a2a-host/
│   │   │   ├── A2AHostService.ts     # Effect service: streaming + push delivery
│   │   │   └── a2a-host.layer.ts
│   │   ├── mcp-proxy/
│   │   │   ├── MCPProxyService.ts    # Effect service: proxy + ghost credential injection
│   │   │   └── mcp-proxy.layer.ts
│   │   ├── colyseus-bridge/          # Phase 2+
│   │   │   ├── Colyseusbridge.ts
│   │   │   └── colyseus-bridge.layer.ts
│   │   ├── errors.ts                 # All Data.TaggedError types for this package
│   │   └── main.ts                   # ManagedRuntime composition + HTTP server start
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── package.json
│   └── README.md
│
├── random-agent/                     # New: Wanderer reference implementation
│   ├── src/
│   │   ├── agent.ts                  # A2A endpoint + MCP movement loop
│   │   ├── executor.ts               # MCP tool calls (whereami, exits, go)
│   │   └── buildAgentCard.ts         # Agent card with matrix extension
│   ├── tests/
│   ├── package.json
│   └── README.md
│
├── tck/                              # Existing: extend with A2A tier suites
│   └── src/
│       ├── index.ts                  # Existing MCP smoke (unchanged)
│       ├── wanderer.ts               # New: Wanderer A2A tier TCK (Phase 1)
│       ├── listener.ts               # New: Listener tier TCK (Phase 2)
│       └── social.ts                 # New: Social tier TCK (Phase 3)
│
└── ghost-cli/                        # Existing: may add catalog commands later
```

**Structure Decision**: Two new pnpm workspace packages (`ghosts/ghost-house/`, `ghosts/random-agent/`) added to `pnpm-workspace.yaml`. Existing `ghosts/random-house/` is preserved untouched (pre-A2A reference; different use case). Ghost-house follows the Effect-ts service/layer pattern from ADR-0002.

## Complexity Tracking

*No Constitution Check violations.*

---

## Phase 0: Research

*Full findings in `research.md`.*

Key resolved questions from spike-008 evidence and RFC-0007 open questions:

1. **Catalog HTTP paths**: Canonicalized from spike `/v1/catalog/*` — see IC-005.
2. **World event envelope**: Production schema `aie-matrix.world-event.v1` — see IC-004.
3. **Spawn context payload**: A2A task delivery with rich JSON payload — see IC-006.
4. **Package placement**: `ghosts/ghost-house/` and `ghosts/random-agent/` follow monorepo convention.
5. **Effect-ts integration**: Ghost house uses `Context.Tag` / `Layer` / `ManagedRuntime`; A2A SDK callbacks surface via `Effect.tryPromise`.
6. **Spawn mechanism**: Deliver spawn context as first A2A task (not raw POST), consistent with A2A SDK patterns validated in spike-008.

---

## Phase 1: Design

*Artifacts: `data-model.md`, `contracts/ic-001` through `ic-006`, `quickstart.md`*

### Delivery milestones

**Phase 1 — Wanderer (weeks 1–2)**

| Milestone | Deliverable | Verification |
|-----------|------------|-------------|
| P1-M1 | `ghosts/ghost-house/`: catalog + A2A host + supervisor (no bridge) | `GET /v1/catalog` returns built-in agents |
| P1-M2 | `ghosts/ghost-house/`: MCP proxy forwarding to world server | `ghost-tck` adopts via proxy; `whereami` returns H3 res-15 |
| P1-M3 | `ghosts/random-agent/`: Wanderer agent with full agent card | TCK Wanderer suite passes |
| P1-M4 | Registration flow end-to-end | `quickstart.md` verified on a clean machine in < 30 min |

**Phase 2 — Listener (weeks 3–4)**

| Milestone | Deliverable | Verification |
|-----------|------------|-------------|
| P2-M1 | Colyseus bridge: `message.new` → A2A push | Listener agent log shows event receipt |
| P2-M2 | Colyseus bridge: proximity + quest events | Events delivered per IC-004 envelope |
| P2-M3 | `observer-agent` example; Listener TCK suite | TCK Listener suite passes (incl. non-speech property) |

**Phase 3 — Social (weeks 5–6)**

| Milestone | Deliverable | Verification |
|-----------|------------|-------------|
| P3-M1 | A2A `say` → Colyseus outbound routing | Echo agent speech appears in world conversation log |
| P3-M2 | Capability manifest surface exposed to agents | Agents can query available capabilities at spawn |
| P3-M3 | First contributed Social agent; Social TCK suite | TCK Social suite passes |

### Phase scope cut policy

If timeline tightens: Phase 2 may be cut after Phase 1 ships; Phase 3 may be cut after Phase 2. Each phase leaves a working system. **Never cut Phase 1 TCK Wanderer conformance** — that is the contribution baseline.

### RFC-0007 / ADR-0004 sync requirement

At each milestone boundary, the implementer MUST:
1. Verify that ADR-0004 and RFC-0007 still match what was built.
2. Update any open question in RFC-0007 §Open Questions that was resolved during implementation.
3. Raise a change request if a significant deviation from either document is required; merge only after approval.
