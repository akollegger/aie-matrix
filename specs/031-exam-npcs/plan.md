# Implementation Plan: Structured Exam NPCs (Quizmaster & Contestant)

**Branch**: `031-exam-npcs` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)

## Summary

Add two NPC behavior kinds — `quizmaster` and `contestant` — to `ghosts/npc-agent`. The quizmaster loads and compiles a human-authored `.exam.gram` file at startup, commits both artifact hashes to an eval contract, conducts the exam conversationally (one question at a time), evaluates answers, and posts a proportional verdict. The contestant accepts any offered exam contract and answers all questions. The world's eval contract service gains two new nullable fields (`artifactRef`, `disclosureRef`) committed at contract creation; settlement is proportional to verdict, rounded up (`ceil(verdict × stakeAmount)`). All other ledger mechanics are unchanged.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `effect` v3+, `@relateby/pattern` ^0.4.2, `@a2a-js/sdk` 0.3.13+, `@modelcontextprotocol/sdk` 1.29+, `node:crypto` (built-in)  
**Storage**: Existing Neo4j ledger (EvalContract nodes, additive field additions); in-memory exam state per NPC ghost  
**Testing**: `node:test` + `vitest` for unit tests (no new test runner); existing `EvalContractService.test.ts` extended  
**Target Platform**: Node.js server (npc-agent process) + world-api server  
**Performance Goals**: Exam compile at startup — one-time, <500ms acceptable. Question delivery latency — bounded by MCP round-trip (~100ms), not a new constraint.  
**Constraints**: No new npm packages beyond what is already in the workspace. No changes to EvalContract state machine. Backward compatible — broker contracts must continue working with `artifactRef: null`.  
**Scale/Scope**: One quizmaster, one contestant per NPC catalog for MVP. One active exam per quizmaster at a time.

## Constitution Check

- ✅ **Proposal linkage**: RFC-0022, RFC-0023, RFC-0027 in `proposals/rfc/`. RFC-0027 Resolution section is a documentation deliverable of this feature.
- ✅ **Boundary-preserving**: `shared/types` owns the EvalContract schema; `server/world-api` owns persistence and ledger logic; `ghosts/npc-agent` owns NPC behavior. No boundary violations.
- ✅ **Contract artifacts**: `contracts/eval-contract-extension.md` and `contracts/exam-snippet-format.md` define all cross-package interfaces before implementation.
- ✅ **Verifiable increments**: Three user stories, each independently testable. WP-1 and WP-2 are independently deployable.
- ✅ **MCP/A2A-first**: All quizmaster→world communication uses existing MCP tools (`eval_contract_open`, `eval_contract_accept`, `eval_contract_submit`, `eval_contract_evaluate`, `say`). No new HTTP endpoints.
- ✅ **Service testing**: `EvalContractServiceInMemory` is the in-memory implementation; unit tests extended in same change. Neo4j integration tests follow in same PR or flagged explicitly.
- ✅ **Documentation impact**: RFC-0027 Resolution section, RFC-0022 schema addendum, `ghosts/npc-agent/README.md` — all in scope.

## Project Structure

### Documentation (this feature)

```text
specs/031-exam-npcs/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── eval-contract-extension.md   ← IC-003
│   └── exam-snippet-format.md       ← IC-001, IC-002
└── tasks.md             ← /speckit.tasks output
```

### Source Code

```text
shared/types/src/
└── eval-contract.ts              ← add artifactRef, disclosureRef

server/world-api/src/
├── EvalContractService.ts        ← extend openContract params
├── EvalContractServiceInMemory.ts ← store new fields, default null
├── EvalContractServiceLive.ts    ← Cypher extension for new fields
└── EvalContractService.test.ts   ← add quizmaster-path unit tests

ghosts/npc-agent/
├── catalog/
│   ├── quizmaster.character.gram   ← NEW
│   └── contestant.character.gram   ← NEW
└── src/
    ├── types.ts                    ← extend behaviorKind union + examPath field
    ├── executor.ts                 ← add dispatch for "quizmaster" and "contestant"
    ├── mcp-effect.ts               ← extend EvalContractOpenArgs with artifactRef/disclosureRef
    ├── exam/                       ← NEW directory
    │   ├── parse-exam-gram.ts      ← @relateby/pattern → QuestionSnippet[]
    │   ├── snippet-compiler.ts     ← QuestionSnippet[] → markdown+frontmatter strings
    │   ├── hash-artifact.ts        ← sha256(concat(snippets)) → hex string
    │   └── exam.test.ts            ← unit tests for compiler + hashing
    ├── behavior/
    │   ├── broker-behavior.ts      ← unchanged
    │   ├── quizmaster-behavior.ts  ← NEW: state machine, exam delivery, evaluation
    │   └── contestant-behavior.ts  ← NEW: state machine, answer generation
    └── catalog/
        └── parse-character-gram.ts ← add examPath parsing
```

**Structure Decision**: All new source goes into existing packages — no new top-level directory. The `exam/` sub-directory groups the exam compilation utilities cleanly within `ghosts/npc-agent/src/`.

---

## Work Packages

Ordered by dependency. WP-1 and WP-2 have no inter-dependency and can proceed in parallel.

### WP-1 — EvalContract schema extension
*Touches: `shared/types`, `server/world-api`*

1. Add `artifactRef: string | null`, `disclosureRef: string | null` to `EvalContract` in `shared/types/src/eval-contract.ts`. No `passMark` — settlement is proportional: `ceil(verdict × stakeAmount)`, handled by the existing `evaluateContract` logic.
2. Extend `EvalContractServiceOps.openContract` params in `server/world-api/src/EvalContractService.ts` (optional `artifactRef?`, `disclosureRef?` — default to `null`).
3. Update `EvalContractServiceInMemory`: store new fields, default to `null`.
4. Update `EvalContractServiceLive`: extend CREATE Cypher to persist new fields; extend RETURN to hydrate them.
5. Extend `eval_contract_open` MCP tool handler to accept and pass through the new params.
6. Add unit tests in `EvalContractService.test.ts` covering quizmaster open-contract path (fields present) and broker path (fields absent → null defaults).
7. `pnpm run build` passes from root.

**Constitution gate**: All new in-memory service paths must have unit tests before merge.

---

### WP-2 — Exam compiler
*Touches: `ghosts/npc-agent/src/exam/`*  
*No dependency on WP-1 — can run in parallel*

1. `parse-exam-gram.ts`: use `@relateby/pattern` `parsePatterns` to load `.exam.gram`. Extract `Problem` nodes and rubric relationship targets. Return `QuestionSnippet[]` sorted lexicographically by `id`.
2. `snippet-compiler.ts`: serialize each `QuestionSnippet` to canonical markdown+frontmatter per `contracts/exam-snippet-format.md`. Produce prompt-only and full variants deterministically.
3. `hash-artifact.ts`: `sha256(Buffer.concat(snippets.map(s => Buffer.from(s, 'utf8'))))` → hex string using `node:crypto`.
4. `exam.test.ts`: unit tests for serialization byte-exactness, hash stability, field omission per artifact view.
5. `pnpm test` in `ghosts/npc-agent` passes.

---

### WP-3 — Quizmaster & contestant behaviors
*Touches: `ghosts/npc-agent/src/`, `ghosts/npc-agent/catalog/`*  
*Depends on: WP-1 (EvalContract fields), WP-2 (exam compiler)*

**3a — Type and dispatch plumbing**
1. Extend `CharacterDefinition` in `src/types.ts`: add `"quizmaster" | "contestant"` to `behaviorKind`; add optional `examPath: string`.
2. Update `src/catalog/parse-character-gram.ts` to extract `examPath`.
3. Extend `mcp-effect.ts` `EvalContractOpenArgs` with `artifactRef?`, `disclosureRef?`.
4. Add dispatch in `executor.ts` tick: `"quizmaster"` → `quizmasterTick`, `"contestant"` → `contestantTick`. Update `Match.exhaustive`.
5. Wire `world.message.new` dispatch for quizmaster (`accept` trigger) and contestant (route to active exam).
6. Wire `world.contract.submitted` to quizmaster handler (parallel to existing broker dispatch).

**3b — Quizmaster behavior** (`src/behavior/quizmaster-behavior.ts`)
- `loadExam(examPath, catalogDir)` → `ExamDefinition` (called once at spawn)
- `quizmasterTick(ghostId)` — advertises in idle phase (inbox-driven, same pattern as broker)
- `quizmasterHandleAccept(ghostId, from)` — creates contract with artifact hashes; sends q1
- `quizmasterHandleAnswer(ghostId, from, text)` — records answer; sends next question or evaluates
- Evaluation: scores each answer per rubric kind; computes weighted verdict; calls `evalContractEvaluate`; posts submission artifact to contract via `submitContract` before evaluating
- `clearQuizmasterState(ghostId)` — cleanup

**3c — Contestant behavior** (`src/behavior/contestant-behavior.ts`)
- `contestantTick(ghostId)` — in idle phase: watches inbox for exam offers; replies `accept`
- `contestantHandleQuestion(ghostId, from, text)` — parses question from message; generates answer (MVP: first option for multiple_choice, `"unknown"` for short_answer, `0` for numerical); sends via `say()`

**3d — Character gram files**
- `catalog/quizmaster.character.gram` (see quickstart.md)
- `catalog/contestant.character.gram` (see quickstart.md)

**3e — Tests**
- `quizmaster-behavior.test.ts`: state machine coverage, verdict computation (full/half/zero)
- `contestant-behavior.test.ts`: idle → answering → idle state transitions
- `pnpm test` passes

---

### WP-4 — RFC documentation updates
*Touches: `proposals/rfc/`*  
*No code dependency — can proceed in parallel with WP-1–3*

1. **RFC-0027**: Add `## Resolution` section closing the format debate (human-authored gram, quizmaster loads and compiles at startup, markdown+frontmatter is artifact/hash target, decoupled from format). Mark Open Questions 1 and 7 as resolved.
2. **RFC-0022**: Add addendum documenting `artifactRef`, `disclosureRef` on EvalContract; document proportional settlement (`ceil(verdict × stakeAmount)`); clarify `submission` semantics for MVP trust tier.
3. **`ghosts/npc-agent/README.md`**: Document quizmaster and contestant behavior kinds; describe `.exam.gram` authoring workflow with example.

---

## Verification

| WP | How to verify |
|---|---|
| WP-1 | `pnpm run build` clean; `cd server/world-api && pnpm test` all pass |
| WP-2 | `cd ghosts/npc-agent && pnpm test` — exam compiler tests pass |
| WP-3 | `cd ghosts/npc-agent && pnpm test` — behavior tests pass; `pnpm run build` clean |
| WP-4 | RFC cross-references resolve; no broken links |
| End-to-end | Start NPC agent with quizmaster + contestant; observe full exam cycle in logs per quickstart.md; `sha256` of submission text matches expected |

## Deferred

- Contestant LLM answer generation (MVP uses fixed/trivial answers)
- `model_graded` question type auto-evaluation
- `@relateby/pattern` 0.6.0 migration (separate spike)
- Progressive multi-stage exams (RFC-0027 S4)
- Cryptographic contestant answer signing
