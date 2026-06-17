# Contract: EvalContract Schema Extension

**IC-003** | Crosses: `shared/types` ↔ `server/world-api` ↔ `ghosts/npc-agent`

## Change

Add two fields to `EvalContract` in `shared/types/src/eval-contract.ts`:

```typescript
export interface EvalContract {
  // ... existing fields unchanged ...

  /** SHA-256 hex of prompt-only artifact. Null for broker (non-exam) contracts. */
  artifactRef: string | null;

  /** SHA-256 hex of full artifact with answer key. Null for broker contracts. */
  disclosureRef: string | null;
}
```

Settlement is proportional to verdict — `ceil(verdict × stakeAmount)` — handled by the existing `evaluateContract` logic. No `passMark` field.

## openContract param extension

`EvalContractServiceOps.openContract` gains two optional params:

```typescript
openContract(params: {
  clientId: string;
  contractorId: string;
  evaluatorId: string;
  request: string;
  stakeResource: string;
  stakeAmount: number;
  deadline: number;
  artifactRef?: string;    // NEW — exam contracts only
  disclosureRef?: string;  // NEW — exam contracts only
}): Effect.Effect<EvalContract, ...>
```

## MCP tool extension

`eval_contract_open` tool (in `server/world-api`) gains matching optional input fields. Existing broker callers passing no `artifactRef`/`disclosureRef` are unaffected — fields default to `null` / `0.6`.

## Downstream consumers

| Consumer | Impact |
|---|---|
| `EvalContractServiceInMemory` | Add fields to in-memory store; default null |
| `EvalContractServiceLive` (Neo4j) | Add fields to CREATE/RETURN Cypher; `null` stored as absent property |
| `EvalContractService.test.ts` | Existing tests unaffected (fields nullable); add quizmaster-path tests |
| `ghosts/npc-agent` | Quizmaster passes `artifactRef`/`disclosureRef` at open |
| `clients/intermedium` | `EvalContract` type consumed for display — new fields are nullable, no breaking change |
