# Implementation Plan: Funder Agent

**Branch**: `025-funder-agent` | **Date**: 2026-06-04 | **RFC**: [RFC-0022 Addendum](../../proposals/rfc/0022-eval-contract-protocol.md#addendum-agent-resource-grants-2026-06-04)

## Summary

Implement a `funder-agent` ghost that exercises the eval contract primitive end-to-end. The funder holds a small supply of a custom resource (`funder-credits`), advertises a simple open-ended question via conversation, opens a contract for any ghost that replies "accept", and auto-evaluates any submission at full score (`v = 1.0`).

This requires two tracks of work:

1. **Resource grant infrastructure** — extend `CatalogEntry` with `resourceGrants`, teach the world-api to register declared resource types at session init, and seed the agent's ghost bag on first connect.
2. **`funder-agent` ghost** — new package in `ghosts/funder-agent/` implementing the conversation tree and contract lifecycle.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM)  
**Dependencies (grants infrastructure)**: existing `effect` v3+, `neo4j-driver` v5, `ulid` — all in `server/world-api`  
**Dependencies (funder-agent)**: `express`, `@a2a-js/sdk`, `@aie-matrix/ghost-ts-client`, `@aie-matrix/root-env` — same as `random-agent`  
**New runtime dependency**: none  
**Storage**: no new storage; eval contracts persist via `EvalContractService`; resource grant state inferred from ledger balance check

---

## Track 1: Resource Grant Infrastructure

### T1-1 — Extend `CatalogEntry` type

**File**: `server/agent-host/src/types.ts`

Add optional `resourceGrants` field to the `"agent"` variant of `CatalogEntry`:

```typescript
resourceGrants?: ReadonlyArray<{
  resourceId: string;    // e.g. "funder-credits"
  label: string;         // e.g. "Funder Credits"
  class: "conserved" | "monotonic";
  qty: number;           // amount seeded into the ghost's bag on first connect
}>
```

---

### T1-2 — Session-init resource type registration

**File**: `server/world-api/src/live/` (wherever `LedgerService.init` is called at session start)

After reading all registered agents from the agent catalog (already done for ghost routing), collect any unique `resourceId` values from their `resourceGrants` arrays. For each new resource type not already in the ledger, call `LedgerService.init()` with an augmented seed list (or add a `registerResourceType(rt: ResourceType)` method to the ledger if init is already sealed by this point).

The world bag receives `0` qty for agent-granted resources — the supply enters the world only when ghost bags are seeded, keeping conservation intact.

---

### T1-3 — First-connect seeding in MCP handler

**File**: `server/world-api/src/mcp-server.ts`

In the authentication/setup path that runs before any tool call (after `authenticateGhostRequestEffect`), check whether the calling ghost's `agentId` has declared resource grants and whether their bag already holds the declared resource:

```
for each grant in agentEntry.resourceGrants:
  if ledger.bag(ghostId)[grant.resourceId] === 0:
    commit deterministic seed tx: world → ghostBag  qty=grant.qty
    (tx id = ulid-from(sessionId + agentId + resourceId))
```

The deterministic ULID prevents double-seeding if the ghost reconnects mid-session; the ledger's duplicate-transaction check rejects the second attempt cleanly.

---

### T1-4 — Unit tests for grant infrastructure

**File**: `server/world-api/src/agent-resource-grants.test.ts` (new)

- Resource type declared in `resourceGrants` is registered with the ledger after session init.
- Ghost with a matching `agentId` receives the declared qty on first MCP call.
- Second MCP call does not re-seed (duplicate tx rejected; balance unchanged).
- Ghost without a matching agent catalog entry is unaffected.

---

## Track 2: Funder Agent

### T2-1 — Package scaffold

**Directory**: `ghosts/funder-agent/`

Copy structure from `ghosts/random-agent/`:
- `package.json` — `@aie-matrix/funder-agent`, same deps as random-agent
- `tsconfig.json`
- `src/agent.ts` — express server, registration loop (identical pattern to random-agent)
- `src/spawn-types.ts` — copy from random-agent (same `SpawnContext` shape)
- `src/world-event.ts` — copy from random-agent

---

### T2-2 — Agent card with resource grants

**File**: `ghosts/funder-agent/src/buildAgentCard.ts`

```typescript
export function buildFunderAgentCard(publicBase: string): AgentCard {
  return {
    name: "funder-agent",
    description: "Offers funder-credits in exchange for answering a simple question.",
    // ...standard fields...
    matrix: {
      requiredTools: ["say", "inbox",
                      "eval_contract_open", "eval_contract_evaluate",
                      "eval_contract_get"],
      // ...
    },
    resourceGrants: [{
      resourceId: "funder-credits",
      label: "Funder Credits",
      class: "conserved",
      qty: 50,   // 50 credits per session; each contract stakes 1
    }],
  };
}
```

> Note: `resourceGrants` is not part of the A2A `AgentCard` spec — it lives in `CatalogEntry`. The agent card builder includes it and the registration endpoint stores it in `catalog.json` as part of the entry.

---

### T2-3 — Executor: conversation tree + contract lifecycle

**File**: `ghosts/funder-agent/src/executor.ts`

State per ghost (keyed by `ghostId`):

```
idle        → (any message)      → advertise, stay in idle
idle        → ("accept")         → open contract, move to awaiting_submission
awaiting_submission → (contract reaches Submitted) → evaluate v=1.0, move to idle
```

Key implementation notes:

- **Advertisement** (`idle` state): reply with a fixed message:
  > "I'll pay 1 funder-credit if you answer this: *[question]*. Reply **accept** to begin."
  The question is a configurable constant in the agent (e.g. `"What is the most interesting thing you've learned today?"`).

- **"accept" handling**: call `eval_contract_open` via `GhostMcpClient.callTool`, naming the sender as `contractorId` and the funder's own `ghostId` as `evaluatorId`. Reply with the contract ID and instructions:
  > "Contract opened (#\<id\>). Call `eval_contract_accept` then `eval_contract_submit` with your answer."

- **Polling for submission**: after opening, poll `eval_contract_get` every 5 seconds. When state is `Submitted`, call `eval_contract_evaluate` with `verdict: 1.0`. Reply to the contractor:
  > "Answer received — full payment sent. Thanks!"

- **Concurrent contracts**: the funder can hold at most N open contracts (default: 5). If at capacity, reply to "accept" with a polite decline. This prevents runaway escrow drain.

- **Insufficient balance**: if `eval_contract_open` fails with `LedgerInsufficientFunds`, reply: "Out of credits for this session."

---

### T2-4 — Catalog registration

**File**: `server/agent-host/catalog.json`

```json
{
  "agents": {
    "funder-agent": {
      "kind": "agent",
      "agentId": "funder-agent",
      "baseUrl": "http://funder-agent:4002",
      "resourceGrants": [{
        "resourceId": "funder-credits",
        "label": "Funder Credits",
        "class": "conserved",
        "qty": 50
      }],
      "builtIn": true,
      "registeredAt": "2026-06-04T00:00:00.000Z",
      "agentCard": { "...": "populated at registration time" }
    }
  }
}
```

---

### T2-5 — Docker Compose service entry

**File**: `docker-compose.yml` (or the staging compose file)

Add a `funder-agent` service mirroring the `random-agent` service, with `AGENT_PORT=4002`.

---

## Task List

### Phase 1: Grant Infrastructure

- [ ] I-T001 Add `resourceGrants` field to `CatalogEntry` "agent" variant in `server/agent-host/src/types.ts`
- [ ] I-T002 Update `server/world-api` session-init path to collect and register resource types from all agent catalog entries that declare `resourceGrants`
- [ ] I-T003 Add `LedgerService.registerResourceType(rt)` method (or extend `init`) to support post-init resource type additions — needed if agents register after session start
- [ ] I-T004 Add first-connect seeding logic in `server/world-api/src/mcp-server.ts`: on authenticated call, check `agentId` grants and seed if balance is zero
- [ ] I-T005 [P] Write unit tests in `server/world-api/src/agent-resource-grants.test.ts` covering happy path, idempotency, and no-op for ungrantd agents

### Phase 2: Funder Agent Package

- [ ] F-T001 Scaffold `ghosts/funder-agent/` with `package.json`, `tsconfig.json`, and copied boilerplate from `random-agent`
- [ ] F-T002 Write `src/buildAgentCard.ts` — funder card with `resourceGrants` and `requiredTools` list
- [ ] F-T003 Write `src/executor.ts` — conversation state machine + contract lifecycle (advertise → accept → open → poll → evaluate)
- [ ] F-T004 Write `src/agent.ts` — express server, registration loop, health endpoint
- [ ] F-T005 Register funder-agent in `server/agent-host/catalog.json` with `resourceGrants`
- [ ] F-T006 [P] Add `funder-agent` service to Docker Compose

### Phase 3: Integration Smoke Test

- [ ] S-T001 Start world-api + funder-agent locally; verify funder ghost bag receives 50 funder-credits on first MCP call
- [ ] S-T002 Send any message to funder ghost via MCP `say`; verify advertisement reply
- [ ] S-T003 Reply "accept"; verify contract opens, funder bag decreases by 1
- [ ] S-T004 Call `eval_contract_accept` and `eval_contract_submit` as contractor; verify funder evaluates at v=1.0 within ~10 seconds
- [ ] S-T005 Verify contractor bag increases by 1 funder-credit; funder bag net = 49

---

## Open Questions

1. **Registration endpoint for `resourceGrants`**: does the agent-host's `/agents/register` endpoint need to store `resourceGrants` from the posted payload, or are grants only sourced from `catalog.json` (built-in agents only for now)?  
   → For built-in agents, `catalog.json` is sufficient. External agent registration can ignore `resourceGrants` until a future RFC.

2. **`LedgerService.registerResourceType` vs re-running `init`**: the current `init` is expected to run once at session start. A lightweight `ensureResourceType` method that no-ops if the type is already registered is cleaner than re-running init.

3. **Question content**: should the funder's question be static (hardcoded), configurable via env var, or driven by a list? Static is fine for the prototype.

4. **Poll interval for submission detection**: 5 seconds is reasonable for a demo. A push/event mechanism (ledger event or Colyseus state) would be better long-term but is out of scope here.
