# Implementation Plan: A2A Ghost House Proof-of-Concept Spike

**Branch**: `008-a2a-ghost-house-spike` | **Date**: 2026-04-24 | **Spec**: [`spec.md`](./spec.md)  
**Input**: Feature specification from `/specs/008-a2a-ghost-house-spike/spec.md`  
**User constraint**: All throwaway spike code and sub-projects live under `spikes/a2a-ghost-agent-protocol/` only — **no** new packages under `packages/`, **no** edits inside `server/`, `ghost-cli/`, or other production workspaces.

**Note**: This file is produced by `/speckit.plan`. Phase 2 task list is `/speckit.tasks` → `tasks.md` (not created here).

## Summary

Time-boxed research (two one-day spikes) validates whether the TypeScript A2A SDK (`@a2a-js/sdk`) supports the four coordination patterns the ghost house needs (sync task, streaming task, push notification, agent-card publish/discover), and whether a cold contributor can register, spawn, and handle one simulated event within four hours using a skeleton house + sample agent.

All executable artifacts are **isolated** under `spikes/a2a-ghost-agent-protocol/` as sibling sub-projects (each with its own `package.json`, local `node_modules`, and scripts). Durable outputs are **Markdown reports** under `spikes/a2a-ghost-agent-protocol/reports/` (and summarized back into ADR-0004 / RFC-0007 per the spec).

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `@a2a-js/sdk` per ADR-0004 / RFC-0007; minimal additional npm deps only where the SDK does not cover HTTP serving (spike-local choice — document in `research.md` if changed)  
**Storage**: N/A  
**Testing**: Manual smoke scripts (`pnpm`/npm scripts that print success markers); optional small script in each sub-project that asserts HTTP responses for CI-free local verification  
**Target Platform**: macOS / Linux developer machines, localhost HTTP  
**Project Type**: Throwaway multi-package spike sandbox (not part of the pnpm workspace)  
**Performance Goals**: None beyond interactive responsiveness for demos  
**Constraints**: No imports from `packages/*` or `server/*`; no shared `tsconfig` extends from monorepo unless read-only path (prefer standalone `tsconfig.json` per sub-project); time-box 1 day per spike  
**Scale/Scope**: Two hosts + one sample agent + reports; Wanderer-tier depth only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Gate | Status |
|------|--------|
| Proposal linkage (`proposals/spikes/...`, ADR-0004, RFC-0007) matches scope | **Pass** — spec links all three; work gates ADR acceptance |
| Architectural boundaries preserved | **Pass** — spike explicitly excludes Colyseus, MCP proxy, Effect server layers; PoC-only isolation documented |
| Contract artifacts for cross-process interfaces | **Pass** — `contracts/ic-008-*` and `contracts/ic-009-*` under this spec directory |
| Verification per user slice | **Pass** — each spike has scripted smoke + report; `quickstart.md` lists commands |
| Root docs (`README.md`, `docs/architecture.md`, …) | **Pass for execution** — no edits required until ADR/RFC appendix merge (spec **Documentation Impact**); optional one-line pointer in repo `README` is **out of scope** for the spike branch unless owners ask |

**Post–Phase 1 re-check**: Data model and contracts align with RFC-0007 agent card appendix and synthetic event capture; no monorepo package boundaries crossed.

## Project Structure

### Documentation (this feature)

```text
specs/008-a2a-ghost-house-spike/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── ic-008-spike-synthetic-world-event.md
│   └── ic-009-rfc-0007-agent-card-field-matrix.md
└── tasks.md             # /speckit.tasks (not created by plan)
```

### Spike sandbox (repository root) — **only** location for runnable throwaway code

```text
spikes/a2a-ghost-agent-protocol/
├── README.md                 # Entry point: isolation rules, links to spec + proposals
├── spike-a-sdk-exercise/   # minimal host + agent pair for FR-001–FR-004
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── README.md           # how to run four exercises + capture logs
├── spike-b-skeleton-house/ # catalog + spawn + one synthetic push (FR-005–FR-007)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   └── README.md           # single registration entry path (FR-005)
├── spike-b-sample-agent/   # one-file (or minimal) contributed agent service
│   ├── package.json
│   ├── src/
│   └── README.md           # contributor-facing steps + timing checklist
└── reports/
    ├── spike-a-sdk-maturity.md
    ├── spike-b-contribution-model.md
    └── README.md           # index + pointers for ADR appendix merge
```

**Structure Decision**: Introduces a new top-level directory `spikes/` with a single child `a2a-ghost-agent-protocol/` so all A2A spike artifacts are namespaced and grep-clean against production code. Sub-projects are **not** linked from the root `pnpm-workspace.yaml`. CI for the monorepo does not run spike installs unless explicitly scoped later.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New top-level `spikes/` directory | User-mandated parent folder for all spike code; keeps throwaway work out of `packages/` and `server/` | Putting spike code under `specs/` or `proposals/` blurs spec vs code and still risks accidental workspace coupling |

## Phase 0 → `research.md`

Consolidated decisions (see file): SDK choice, localhost networking assumptions, report template, and explicit **non-goals** (no monorepo wiring).

## Phase 1 → `data-model.md`, `contracts/`, `quickstart.md`

Entity definitions, spike-only message shapes (`ic-008`), RFC-0007 field matrix template (`ic-009`), and copy-paste commands for maintainers and simulated contributors.
