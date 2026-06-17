# Implementation Plan: NPC Agent — Rule-Based Character Roster

**Branch**: `028-npc-agent` | **Date**: 2026-06-10 | **Spec**: [spec.md](spec.md)
**RFC**: [RFC-0026](../../proposals/rfc/0026-npc-agent.md) — NPC Agent: Rule-Based Character Roster
**Input**: Feature specification from `/specs/028-npc-agent/spec.md`

## Summary

Add `npc-agent`, a deterministic (no-LLM) ghost agent that draws characters from a catalog of `.character.gram` files and, on session start, spawns one ghost per enabled character — driving each via a priority-ordered behavior-rule table and a scripted dialog tree. The character engine (catalog parsing, rule evaluation, dialog traversal with per-partner state) is built entirely on existing MCP tools and the gram tooling already used for maps/calendars. To make "a top-level agent spawns its whole roster" a first-class supported flow, the feature also adds three minimal capabilities to existing services (RFC-0026 §4): an agent-callable spawn endpoint with scoped auth, emission of the defined-but-unused `world.session.start` event, and a per-ghost `background` field.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)
**Primary Dependencies**: `@a2a-js/sdk` 0.3.13+, `@modelcontextprotocol/sdk` 1.29+, `@aie-matrix/ghost-ts-client` (workspace), `@aie-matrix/root-env` (workspace), `@relateby/pattern` ^0.4.2 (catalog gram parsing — pin matches `shared/map-gram`), `express` ^4.21, `h3-js` ^4.1, `effect` v3+ (server-side service layers), `ulid`
**Storage**: `.character.gram` files on disk under `NPC_CATALOG_DIR` (catalog); in-memory `Map` per-character/per-partner dialog state; Neo4j-backed registry gains a per-ghost `background` property (additive)
**Testing**: `vitest` unit tests in `ghosts/npc-agent/tests/` (mock `GhostMcpClient`); `@aie-matrix/ghost-tck` integration scripts in `ghosts/tck/src/` (live server, external-ghost driven)
**Target Platform**: Linux server container (Docker/compose; k8s optional, compose-only acceptable per funder-agent precedent)
**Project Type**: Multi-package pnpm workspace — new agent package + additive server changes (agent-host, world server, registry)
**Performance Goals**: Roster of ≤20 characters spawned within 30s of session start (SC-001); dialog reply within 2s (SC-003); catalog of 10 chars × 5 rules loads/validates < 1s (SC-005)
**Constraints**: Zero LLM API calls anywhere in the critical path (FR-013/SC-006); deterministic behavior except response-text variety; new privileged spawn endpoint must use scoped credentials (Constitution Principle V)
**Scale/Scope**: One npc-agent process driving up to ~20 concurrent character loops, each with up to k concurrent per-partner conversations (n·k dialog states)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Proposal linkage** ✅ — [RFC-0026](../../proposals/rfc/0026-npc-agent.md) (draft) covers the agent, the `.character.gram` format, and the host spawn capability. Scope matches this plan.
- **Boundary-preserving design** ⚠️ JUSTIFIED — the feature crosses the agent-host/world-server boundary (RFC-0007) to add an agent-callable spawn endpoint, `world.session.start` emission, and a per-ghost `background` field. These are additive and documented as contracts (IC-006/007/008). RFC-0026 Open Question #1 flags whether a companion ADR is warranted; see Complexity Tracking. No existing boundary is removed or repurposed.
- **MCP/A2A-first interfaces** ✅ — all ghost-facing operations reuse existing MCP tools (IC-003); dialog uses the existing `say`/world-event path; the new spawn endpoint is host-infrastructure (agent lifecycle), not a domain operation, and uses scoped auth (no parallel bare-secret path).
- **Contract-explicit interfaces** ✅ — `.character.gram` shape (IC-001), spawn-context reuse (IC-002), MCP tool set (IC-003), env var (IC-004), agent card + world-event consumption (IC-005), and the three new service contracts (IC-006/007/008) are all enumerated with `contracts/` artifacts planned.
- **Verifiable increments** ✅ — four prioritized user stories (P1–P4), each independently testable; unit tests (in-memory engine) ship with the package, integration tests via tck. Package README + quickstart document local runs.
- **Service testing** ✅ — the new `.character.gram` parser and any Effect service layer (e.g. spawn-roster service) get unit tests covering each method + typed error paths; the registry `background` change and spawn endpoint get integration coverage (live server) per the tiered requirement.
- **Documentation impact** ✅ — enumerated in spec (`docs/project-overview.md`, `ghosts/npc-agent/README.md`, `schema/character.gram.md`, `AGENTS.md`); plan adds `docs/architecture.md` (new host spawn capability) and `proposals/rfc/0026`.

**Gate verdict: PASS** (one justified boundary-crossing tracked below).

## Project Structure

### Documentation (this feature)

```text
specs/028-npc-agent/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── character.gram.md            # catalog gram shape (IC-001)
│   ├── agent-spawn-endpoint.md      # agent-callable spawn (IC-006)
│   ├── world-session-start.md       # session.start event (IC-007)
│   └── ghost-background.md          # per-ghost background field (IC-008)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
ghosts/npc-agent/                    # NEW package, mirrors ghosts/random-agent/
├── package.json                     # @aie-matrix/npc-agent; adds @relateby/pattern, ulid
├── tsconfig.json                    # extends ../../tsconfig.base.json
├── vitest.config.ts
├── Dockerfile                       # 3-stage, mirrors random-agent (+ @relateby/pattern in build order)
├── README.md                        # catalog format, env vars, how to add a character
├── schema/
│   └── character.gram.md            # documented gram shape (IC-001)
├── catalog/                         # default NPC_CATALOG_DIR for local dev
│   └── *.character.gram             # example characters
├── src/
│   ├── agent.ts                     # express A2A server + register/deregister (mirror random-agent)
│   ├── executor.ts                  # AgentExecutor: session.start → spawn roster; message.new → dialog
│   ├── buildAgentCard.ts            # pushNotifications:true, llmProvider:none
│   ├── spawn-types.ts               # SpawnContext (copy)
│   ├── world-event.ts               # WorldEvent + WorldEventKind (copy funder-agent's typed version)
│   ├── catalog/
│   │   ├── parse-character-gram.ts  # @relateby/pattern → CharacterDefinition (strict, skip-on-error)
│   │   └── catalog-loader.ts        # read NPC_CATALOG_DIR, validate, dedupe, filter enabled
│   ├── behavior/
│   │   └── rule-engine.ts           # priority-ordered condition→action evaluation
│   ├── dialog/
│   │   └── dialog-engine.ts         # tree traversal, per-partner state, keyword matching
│   └── roster/
│       └── spawn-roster.ts          # call agent-callable spawn endpoint per enabled character
└── tests/
    ├── parse-character-gram.test.ts
    ├── rule-engine.test.ts
    ├── dialog-engine.test.ts         # per-partner isolation, sibling-NPC ignore, fallback
    └── buildAgentCard.test.ts

server/agent-host/src/                # ADDITIVE changes
├── app.ts                           # NEW agent-callable spawn route (scoped auth)
└── supervisor/SupervisorService.ts  # reuse spawn engine; roster spawn entry

server/world-api/src/ + server/src/   # ADDITIVE: emit world.session.start fanout on session begin
server/registry/src/routes/adoption.ts # ADDITIVE: accept + persist per-ghost background

ghosts/tck/src/
└── npc.ts                            # NEW integration harness (mirror social.ts): external ghost(s) drive dialog
```

**Structure Decision**: New top-level package under the existing `ghosts/` directory (justified by RFC-0026 and consistent with `random-agent`/`funder-agent` — not a new top-level dir). Server changes are additive edits within existing package boundaries. Catalog parsing lives package-local (`src/catalog/`) following the calendar/leaderboard precedent rather than a new `shared/` package; revisit if a client needs to read characters (Open Question, research.md).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Cross-boundary change to agent-host + world server (new spawn endpoint, `session.start` emission, per-ghost `background`) | The user-selected design requires a single top-level agent to spawn its whole roster on session start; no supported path exists today (spawn endpoint needs host dev token; `session.start` never emitted; background not per-ghost) | "External orchestrator only" (build just the engine, spawn via demo-script) was offered and rejected by the stakeholder — it demotes "top-level agent spawns every character" from a capability to a script, contradicting the feature's intent |
| Companion ADR (RFC-0026 OQ#1) | The agent-host/world-server boundary and a new privileged auth surface are costly-to-reverse | RESOLVED — [ADR-0012: Ghost Self-Spawn Lifecycle](../../proposals/adr/0012-ghost-self-spawn-lifecycle.md) records the agent-driven self-spawn decision + ADR-0011 scoped-credential auth. Interim credential shape flagged for maintainer confirmation in ADR-0012 |
