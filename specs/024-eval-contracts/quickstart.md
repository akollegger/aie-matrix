# Quickstart: Eval Contracts

**Feature**: 024-eval-contracts

## Prerequisites

- `pnpm install` from repo root
- Neo4j running (for integration tests / live server)
- `pnpm dev` starts `server/world-api` with MCP endpoint at `http://localhost:2567/mcp`

## Running Unit Tests

```bash
# From repo root
pnpm test

# Or scoped to world-api
cd server/world-api && pnpm test
```

Unit tests use `EvalContractServiceInMemory` — no live services required.

## Running Integration Tests

```bash
# Requires NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD in environment or .env
cd server/world-api && NEO4J_URI=bolt://localhost:7687 pnpm test
```

Integration tests using `EvalContractServiceLive` are skipped automatically when `NEO4J_URI` is absent.

## Smoke Test: Full Contract Lifecycle via MCP

With `pnpm dev` running, authenticate two ghost tokens (client and contractor) and an evaluator token. Using any MCP client:

```bash
# 1. Client opens a contract
eval_contract_open {
  contractorId: "ghost-B",
  evaluatorId: "ghost-C",
  request: "{\"question\":\"What is 2+2?\"}",
  stakeResource: "tokens",
  stakeAmount: 100,
  deadlineMs: <now + 3600000>
}
# → state: Open, contractId: <id>

# 2. Contractor accepts
eval_contract_accept { contractId: "<id>" }
# → state: Accepted

# 3. Contractor submits
eval_contract_submit { contractId: "<id>", submission: "{\"answer\":\"4\"}" }
# → state: Submitted

# 4. Evaluator issues verdict
eval_contract_evaluate { contractId: "<id>", verdict: 1.0 }
# → state: Settled, contractorPayment: 100, clientRefund: 0

# 5. Verify bags
ledger_bag { actorId: "ghost-B" }  # tokens increased by 100
ledger_bag { actorId: "ghost-A" }  # tokens decreased by 100 net
```

## Key Source Locations (after implementation)

| What | Where |
|---|---|
| Service interface | `server/world-api/src/EvalContractService.ts` |
| In-memory impl | `server/world-api/src/EvalContractServiceInMemory.ts` |
| Neo4j impl | `server/world-api/src/EvalContractServiceLive.ts` |
| Error types | `server/world-api/src/eval-contract-errors.ts` |
| MCP tools | `server/world-api/src/mcp-server.ts` (eval_contract_* section) |
| Shared types | `shared/types/src/eval-contract.ts` |
| Unit tests | `server/world-api/src/EvalContractService.test.ts` |
