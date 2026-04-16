# Implementation Plan: Rule-Based Movement (Gram + @relateby/pattern)

**Branch**: `003-rule-based-movement` | **Date**: 2026-04-16 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification + user direction: Gram files (e.g. `sandbox.rules.gram`), `@relateby/pattern` for parsing and graph/pattern representation.

## Summary

Replace the permissive `rulesetAllowsMove` stub in `server/world-api` with **authored Gram rulesets** parsed via **`@relateby/pattern`** (`Gram.parse` → `Pattern<Subject>[]`). Evaluation keeps **geometry-first** checks in `evaluateGo`, then applies **allow-list** matching against the parsed **rule graph**. A **permissive** configuration preserves today’s “any class pair” behavior. Runtime **world state** stays in Colyseus `LoadedMap` + room state; **Subject** snapshots are built per request for matching against rules — the full world is **not** materialized as a persisted Pattern graph (see [research.md](./research.md)).

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (repo standard)  
**Primary Dependencies**: `effect` ^3.21 (existing); **`@relateby/pattern` ^0.2.9** (adds `Gram`, `Pattern`, `Subject`, graph helpers; peer `effect >= 3`)  
**Storage**: Rules as **repository files** (`.rules.gram`); no new database for this slice  
**Testing**: Add **`node:test`** (built-in) or minimal test runner under `server/world-api` for `evaluateGo` fixtures; optional TCK extension later  
**Target Platform**: Combined server / local PoC (`pnpm run poc:server`)  
**Project Type**: Monorepo package enhancement (`@aie-matrix/server-world-api`)  
**Performance Goals**: Adjacent `go` remains interactive; rulesets are small (dozens to hundreds of edges); target consistent with [spec.md](./spec.md) SC-004  
**Constraints**: No edits inside `server/colyseus` core for `GO` (per RFC); Effect `R` wiring must satisfy new services in `ManagedRuntime` when integrated  
**Scale/Scope**: Single-room PoC maps; rules files sized for human authoring

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status |
|------|--------|
| Proposal linkage | **Pass** — [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md) + [spec.md](./spec.md) |
| Architectural boundaries | **Pass** — Evaluation stays in `server/world-api`; Colyseus internals unchanged; bridge seam pattern preserved |
| Contract artifacts | **Pass** — [contracts/ic-003-gram-ruleset.md](./contracts/ic-003-gram-ruleset.md), [contracts/ic-003-go-evaluation.md](./contracts/ic-003-go-evaluation.md) |
| Verification | **Pass** — [quickstart.md](./quickstart.md) defines local steps; implementation must add executable smoke/unit tests |
| Documentation impact | **Pass** — Enumerated in quickstart; `server/world-api/README.md` + optional `docs/architecture.md` touch listed |

**Post-design re-check**: Research resolves `@relateby/gram` vs bundled Gram (bundled in `@relateby/pattern`); data model and contracts align with IC-003-A/B. No constitution violations requiring the complexity table.

## Project Structure

### Documentation (this feature)

```text
specs/003-rule-based-movement/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ic-003-gram-ruleset.md
│   └── ic-003-go-evaluation.md
└── tasks.md              # /speckit.tasks (not created by this command)
```

### Source Code (repository root)

```text
server/world-api/
├── package.json                    # add @relateby/pattern
├── README.md                       # rules path, env, failure behavior
├── src/
│   ├── movement.ts                 # extend evaluateGo / rulesetAllowsMove
│   ├── index.ts                    # exports as needed
│   ├── mcp-server.ts               # wire config if evaluation needs services
│   └── rules/                      # new: load + match helpers
│       ├── gram-rules.ts           # Gram.parse Effect, permissive vs authored
│       ├── match.ts                # allow-list evaluation using Pattern / graph views
│       └── fixtures/
│           └── sandbox.rules.gram  # example corpus (name per team convention)
shared/types/
└── src/ghostMcp.ts                 # optional: document new RULESET_* subcodes
```

**Structure Decision**: All new logic lives under **`server/world-api`** per RFC package ownership. Gram fixtures sit beside loaders to keep tests colocated. No new top-level directory.

## Complexity Tracking

No constitution violations requiring justification.

## Phase 0 — Research

**Output**: [research.md](./research.md)

Resolved items:

- Gram files + `@relateby/pattern` for parse and rule-graph representation.
- **`@relateby/gram` npm package**: not used — Gram API ships inside `@relateby/pattern`.
- World graph: **Subject snapshots** for evaluation; **not** a full persisted Pattern world graph.

## Phase 1 — Design & contracts

**Outputs**:

- [data-model.md](./data-model.md) — entities, validation, transitions.
- [contracts/ic-003-gram-ruleset.md](./contracts/ic-003-gram-ruleset.md) — authoring/loading contract.
- [contracts/ic-003-go-evaluation.md](./contracts/ic-003-go-evaluation.md) — `go` ordering and codes.
- [quickstart.md](./quickstart.md) — verification steps for implementers.

**Agent context**: Ran `.specify/scripts/bash/update-agent-context.sh codex` after filling this plan.

## Phase 2 — Implementation (forward-looking; not executed here)

Tracked by `/speckit.tasks`: dependency add, loader, matcher, fixtures, tests, README, optional map label encoding ADR if `tileClass` changes shape.
