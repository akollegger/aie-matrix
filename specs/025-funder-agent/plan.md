# Implementation Plan: Funder Agent

**Branch**: `025-funder-agent` | **Date**: 2026-06-04 | **RFC**: [RFC-0022 Addendum](../../proposals/rfc/0022-eval-contract-protocol.md#addendum-agent-resource-grants-2026-06-04)

## Summary

Implement a `funder-agent` ghost that exercises the eval contract primitive end-to-end. The funder holds a small supply of a custom resource (`funder-credits`), advertises a simple open-ended question via conversation, opens a contract for any ghost that replies "accept", and auto-evaluates any submission at full score (`v = 1.0`).

This requires three tracks of work:

1. **Resource grant infrastructure** — extend `CatalogEntry` with `resourceGrants`, add `LedgerService.ensureResourceType`, seed the agent's ghost bag on first connect.
2. **Contract submission event** — add `world.contract.submitted` to `WorldEventKind` and dispatch it from `submitContract` to the evaluator ghost via A2A.
3. **`funder-agent` ghost** — new package in `ghosts/funder-agent/` implementing the conversation tree and contract lifecycle.

## Resolved Design Decisions

| Question | Decision |
|---|---|
| `resourceGrants` scope | Built-in agents only — sourced from `catalog.json`; ignored on external `/register` payloads |
| `LedgerService` extension | Add `ensureResourceType(rt: ResourceType)` — idempotent, no-ops if already registered |
| Question content | Baked-in list of 10 questions, one picked randomly per contract (see below) |
| Submission detection | A2A push — `world.contract.submitted` event dispatched to evaluator when contractor submits |

## Question Bank

```typescript
const QUESTIONS = [
  "What's one thing you wish AI systems were better at?",
  "If you could add one feature to this world, what would it be?",
  "What's the most surprising thing about being a ghost in a digital world?",
  "Describe your ideal collaboration between a human and an AI.",
  "What question would you ask an AI that no one has thought to ask yet?",
  "What's worth preserving as AI gets more capable?",
  "If this world had a newspaper, what would today's headline be?",
  "What's the difference between being helpful and being useful?",
  "What would you do with more time?",
  "What does it mean to know something?",
];
```

One question is chosen at random when a contract is opened (not at advertisement time — so the ghost hears the question only after committing to answer).

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM)  
**Dependencies (grants + event)**: existing `effect` v3+, `neo4j-driver` v5, `ulid` — all in `server/world-api`; `@a2a-js/sdk/client` for A2A push dispatch  
**Dependencies (funder-agent)**: `express`, `@a2a-js/sdk`, `@aie-matrix/ghost-ts-client`, `@aie-matrix/root-env` — same as `random-agent`  
**New runtime dependency**: none  
**Storage**: no new storage; eval contracts persist via `EvalContractService`; resource grant state inferred from ledger balance

---

## Track 1: Resource Grant Infrastructure

### T1-1 — Extend `CatalogEntry` type

**File**: `server/agent-host/src/types.ts`

Add optional `resourceGrants` field to the `"agent"` variant of `CatalogEntry`:

```typescript
resourceGrants?: ReadonlyArray<{
  resourceId: string;   // e.g. "funder-credits"
  label: string;        // e.g. "Funder Credits"
  class: "conserved" | "monotonic";
  qty: number;          // amount seeded into the ghost's bag on first connect
}>
```

`resourceGrants` is **not** accepted from external `/register` payloads — only entries already in `catalog.json` (built-in agents) are acted upon.

---

### T1-2 — Add `ensureResourceType` to `LedgerService`

**Files**: `server/world-api/src/LedgerService.ts`, `LedgerServiceInMemory.ts`, `LedgerServiceLive.ts`

```typescript
ensureResourceType(rt: ResourceType): Effect.Effect<void, LedgerPersistenceError>
```

Registers the resource type if not already present; no-ops otherwise. Called during session init (after `init()`) and potentially on agent first-connect. The world bag receives `qty: 0` for agent-granted conserved resources — supply enters only via ghost seed grants.

---

### T1-3 — Session-init resource type registration

**File**: `server/world-api/src/live/` (wherever session init runs)

After `LedgerService.init()`, iterate all `catalog.json` entries with `resourceGrants`, call `ensureResourceType` for each unique `resourceId`.

---

### T1-4 — First-connect seeding in MCP handler

**File**: `server/world-api/src/mcp-server.ts`

In the per-request authentication path, after the ghost identity is established, check if the ghost's `agentId` maps to a catalog entry with `resourceGrants`. For each grant where `ledger.bag(ghostId)[grant.resourceId] === 0`, commit a seed transaction:

- `from: "world"`, `to: ghostId`, `qty: grant.qty`, `cause: "agent.resource-grant"`
- Transaction ID: deterministic ULID derived from `sha256(sessionId + agentId + resourceId)` — ledger's duplicate-tx check prevents double-seeding on reconnect.

---

### T1-5 — Unit tests

**File**: `server/world-api/src/agent-resource-grants.test.ts` (new)

- `ensureResourceType` registers a new type; calling again is a no-op.
- Ghost with matching `agentId` receives declared qty on first MCP call.
- Second call (same session) does not re-seed — balance unchanged.
- Ghost without a catalog entry is unaffected.

---

## Track 2: Contract Submission Event

### T2-1 — Add `world.contract.submitted` event kind

**File**: `shared/types/src/channels.ts` (or wherever `WorldEventKind` is defined)

```typescript
export type WorldEventKind =
  | "world.message.new"
  | "world.proximity.enter"
  | "world.proximity.exit"
  | "world.quest.trigger"
  | "world.session.start"
  | "world.session.end"
  | "world.contract.submitted";  // ← new
```

Payload shape: `{ contractId: string; contractorId: string }`.

---

### T2-2 — Dispatch event from `submitContract`

**File**: `server/world-api/src/EvalContractServiceLive.ts` (or the MCP tool handler for `eval_contract_submit`)

After a successful `Submitted` state transition, look up the evaluator's `agentId` from the agent-host registry and push a `world.contract.submitted` event to their A2A endpoint via the existing world-event dispatch mechanism (same path as `world.message.new`).

If the evaluator is not a registered agent (human ghost or no A2A endpoint), skip the dispatch silently — the evaluator can still issue a verdict manually.

---

### T2-3 — Unit test for event dispatch

**File**: `server/world-api/src/EvalContractService.test.ts` (extend existing)

- Verify `world.contract.submitted` event is dispatched to evaluator after `submitContract`.
- Verify no dispatch occurs if evaluator has no A2A endpoint.

---

## Track 3: Funder Agent

### T3-1 — Package scaffold

**Directory**: `ghosts/funder-agent/`

Mirror `ghosts/random-agent/` structure:
- `package.json` — `@aie-matrix/funder-agent`; same deps as `random-agent`
- `tsconfig.json`
- `src/spawn-types.ts` — shared `SpawnContext` shape (copy)
- `src/world-event.ts` — `WorldEvent` + `WorldEventKind` (copy, update to include `world.contract.submitted`)

---

### T3-2 — Agent card

**File**: `ghosts/funder-agent/src/buildAgentCard.ts`

```typescript
matrix: {
  requiredTools: ["say", "inbox",
                  "eval_contract_open", "eval_contract_evaluate"],
  // eval_contract_get not needed — funder reacts to push, not poll
}
```

`resourceGrants` lives in `catalog.json`, not the agent card.

---

### T3-3 — Executor: conversation tree + event-driven evaluation

**File**: `ghosts/funder-agent/src/executor.ts`

**State per ghost** (keyed by `ghostId`):

```
idle
  → any message            → reply with advertisement; stay idle
  → "accept" (case-insensitive, trimmed) → pick random question, open contract,
                                            reply with contract ID + instructions;
                                            move to awaiting_submission
  → at capacity (≥5 open)  → reply "I'm fully booked right now, try again soon."
  → insufficient balance   → reply "Out of credits for this session."

awaiting_submission
  → world.contract.submitted event → call eval_contract_evaluate v=1.0,
                                      reply "Answer received — full payment sent!",
                                      move to idle
```

**Advertisement message**:
> "I'll pay 1 funder-credit if you answer a question for me. Reply **accept** to hear the question and begin."

**Post-accept message** (after contract opened):
> "Contract #\<id\> is open. Your question: *\<question\>*\n\nCall `eval_contract_accept` then `eval_contract_submit` with your answer."

**Post-evaluation message** (sent to contractor ghost via `say`):
> "Answer received — 1 funder-credit sent. Thanks for playing!"

**Concurrent contract cap**: max 5 open contracts per funder ghost. Checked before calling `eval_contract_open`.

---

### T3-4 — Agent server

**File**: `ghosts/funder-agent/src/agent.ts`

Standard express server + registration loop, identical to `random-agent`. Port default: `4002` (`AGENT_PORT` env override).

---

### T3-5 — Catalog registration

**File**: `server/agent-host/catalog.json`

Add `funder-agent` entry with `resourceGrants`, `builtIn: true`, `baseUrl: http://funder-agent:4002`.

---

### T3-6 — Docker Compose service

**File**: `docker-compose.yml`

Add `funder-agent` service mirroring `random-agent` with `AGENT_PORT=4002`.

---

## Task List

### Phase 1: Grant Infrastructure

- [ ] I-T001 Add `resourceGrants` to `CatalogEntry` "agent" variant in `server/agent-host/src/types.ts`
- [ ] I-T002 Add `ensureResourceType(rt)` to `LedgerService.ts`, `LedgerServiceInMemory.ts`, `LedgerServiceLive.ts`
- [ ] I-T003 Call `ensureResourceType` for all agent `resourceGrants` during session init in `server/world-api/src/live/`
- [ ] I-T004 Add first-connect seeding logic in `server/world-api/src/mcp-server.ts`
- [ ] I-T005 [P] Write unit tests in `server/world-api/src/agent-resource-grants.test.ts`

### Phase 2: Contract Submission Event

- [ ] E-T001 Add `"world.contract.submitted"` to `WorldEventKind` in `shared/types/src/channels.ts`
- [ ] E-T002 Dispatch `world.contract.submitted` from `eval_contract_submit` MCP handler to evaluator's A2A endpoint
- [ ] E-T003 [P] Extend `EvalContractService.test.ts` with dispatch assertion

### Phase 3: Funder Agent Package

- [ ] F-T001 Scaffold `ghosts/funder-agent/` — `package.json`, `tsconfig.json`, boilerplate
- [ ] F-T002 Write `src/buildAgentCard.ts` with `requiredTools`
- [ ] F-T003 Write `src/executor.ts` — conversation state machine, question bank, event-driven evaluation
- [ ] F-T004 Write `src/agent.ts` — express server + registration loop
- [ ] F-T005 Add funder-agent entry to `server/agent-host/catalog.json`
- [ ] F-T006 [P] Add `funder-agent` service to `docker-compose.yml`

### Phase 4: Integration Smoke Test

- [ ] S-T001 Start world-api + funder-agent; verify funder bag receives 50 funder-credits on first MCP call
- [ ] S-T002 Send any message to funder ghost; verify advertisement reply
- [ ] S-T003 Reply "accept"; verify contract opens, funder bag decreases by 1, funder replies with question
- [ ] S-T004 Call `eval_contract_accept` + `eval_contract_submit` as contractor; verify funder receives `world.contract.submitted` and evaluates at v=1.0
- [ ] S-T005 Verify contractor bag increases by 1 funder-credit; funder bag net = 49
