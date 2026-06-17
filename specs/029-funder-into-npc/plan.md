# Implementation Plan: Migrate funder-agent into npc-agent

**Branch**: `029-funder-into-npc` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)

## Summary

Move the funder character's stateful contract-negotiation behavior into npc-agent as a `behaviorKind: "funder"` dispatch path, eliminating the standalone funder-agent container. The funder's per-ghost state machine (idle / awaiting_submission) and inbox-poll loop are extracted from `ghosts/funder-agent/src/executor.ts` into a new `funder-behavior.ts` module alongside the existing `rule-engine.ts`. The catalog parser is extended to read the optional `behaviorKind` field (defaulting to `"rule-engine"`), a `funder.character.gram` catalog entry is added, and `deploy/staging/docker-compose.yml` is updated to remove the `funder-agent` service.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `@a2a-js/sdk` 0.3.13+, `@aie-matrix/ghost-ts-client` (workspace), `@relateby/pattern` ^0.4.2  
**Storage**: In-memory `Map` (per-ghost funder state); no new persistence  
**Testing**: `vitest` — unit tests in `ghosts/npc-agent/tests/`  
**Target Platform**: Node.js 24 process (Docker container, merged into npc-agent image)  
**Project Type**: Ghost agent service  
**Performance Goals**: Inherits npc-agent's 3 s tick interval; no new latency targets  
**Constraints**: Funder state maps are process-local; cleared on re-spawn (acceptable — sessions are short-lived)  
**Scale/Scope**: One funder ghost per session, same as today

## Constitution Check

- **Proposal linkage**: Architectural decision made in conversation; no formal RFC/ADR required (this is a consolidation, not a new capability). A PR description is sufficient per the constitution's "small, well-understood fixes" exemption.
- **Boundary-preserving**: All changes stay within `ghosts/npc-agent/` plus deploy config. No new cross-package interfaces. funder-agent's MCP tool calls are identical to today.
- **Verifiable increments**: Three independently testable slices (User Stories 1–3 in spec). Unit tests added for `funder-behavior.ts`.
- **Contract-explicit interfaces**: IC-001–IC-003 in spec define the `funderTick` signature, gram property, and event routing. No new cross-package contracts.
- **Contribution hygiene**: DCO sign-off required on all commits.
- **Build gate**: `pnpm run build` must pass before PR.
- **Test gate**: `pnpm test` in `ghosts/npc-agent/` must pass. New unit tests cover `funderTick` happy path and `handleContractSubmitted`.

## Project Structure

### Documentation (this feature)

```text
specs/029-funder-into-npc/
├── plan.md               # This file
├── research.md           # Phase 0 output
├── data-model.md         # Phase 1 output
├── contracts/            # Phase 1 output
└── tasks.md              # /speckit.tasks output
```

### Source Code Changes

```text
ghosts/npc-agent/
├── src/
│   ├── types.ts                        # ADD behaviorKind to CharacterDefinition
│   ├── behavior/
│   │   ├── rule-engine.ts              # UNCHANGED
│   │   └── funder-behavior.ts          # NEW — funderTick + per-ghost state maps
│   ├── catalog/
│   │   └── parse-character-gram.ts     # EXTEND — read behaviorKind; default "rule-engine"
│   └── executor.ts                     # EXTEND — dispatch seam + world.contract.submitted routing
├── catalog/
│   └── funder.character.gram           # NEW — catalog entry for funder character
└── tests/
    └── funder-behavior.test.ts         # NEW — unit tests for funderTick and handleContractSubmitted

deploy/staging/
└── docker-compose.yml                  # REMOVE funder-agent service block

ghosts/funder-agent/                    # RETIRE — removed from compose; package left in repo
```

## Phase 0: Research

### R-001 — Gram parser extensibility for optional `behaviorKind`

**Question**: Can `behaviorKind` be added to the `Character` node as an optional string property without breaking existing gram files?

**Finding**: Yes. `strProp(charProps, "behaviorKind")` returns `undefined` for missing keys — no error thrown. Defaulting to `"rule-engine"` when absent is safe. Existing gram files (`collector`, `hermit`, `info-attendant`) need no changes.

**Decision**: Read `behaviorKind` as optional in `parseCharacterGramText`. Default to `"rule-engine"` when absent.

---

### R-002 — Dialog tree requirement for funder gram file

**Question**: The catalog parser requires a `HAS_DIALOG` relationship. Must `funder.character.gram` have a full dialog tree, or should the parser be relaxed?

**Finding**: The parser fails with `"no HAS_DIALOG relationship found"` if the relationship is missing. Two options:
- A) Add a minimal stub dialog tree to `funder.character.gram` (one idle node with self-loop). Parser unchanged.
- B) Make `HAS_DIALOG` optional when `behaviorKind === "funder"` — parser returns a synthetic empty dialog tree.

**Decision**: Option A — minimal stub dialog tree in the gram file. Keeps the parser invariant simple; avoids leaking behavior-kind knowledge into the gram format layer. The stub is never invoked by the funder behavior path.

---

### R-003 — Funder tick integration into Effect fiber loop

**Question**: How does `funderTick` slot into the existing `ghostActionLoop` Effect structure without restructuring it?

**Finding**: The inner tick Effect calls `evaluateRules` inside a `tryPromise`. For funder, snapshot building (`whereami`, `exits`, `inventory`, `look`) is unnecessary — funder polls inbox directly. The seam is a conditional before `evaluateRules`:

```ts
if (characterDef.behaviorKind === "funder") {
  await funderTick(ctx.ghostId, mcp);
} else {
  const snapshot = buildSnapshot(...);
  await evaluateRules(characterDef, snapshot, mcp);
}
```

The existing `tryPromise` wrapper and non-fatal `catchAll` cover both branches.

**Decision**: Inline conditional dispatch inside the existing tick `tryPromise`. No new abstraction.

---

### R-004 — State clearing on re-spawn

**Question**: Where does funder per-ghost state get cleared when a ghost is re-spawned?

**Finding**: `launchGhostLoop` already calls `Fiber.interrupt(existing)` before forking a new fiber. State clearing belongs here, after the interrupt and before the fork.

**Decision**: Export `clearFunderState(ghostId: string): void` from `funder-behavior.ts`. Call it from `launchGhostLoop` when `characterDef.behaviorKind === "funder"`.

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md).

### Interface Contracts

See [contracts/](./contracts/).

### Agent Context Update

Run after plan artifacts are written:
```bash
bash .specify/scripts/bash/update-agent-context.sh claude
```
