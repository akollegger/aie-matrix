# MCP Tool Contracts: Eval Contracts

**Feature**: 024-eval-contracts  
**Date**: 2026-06-04  
**Interface**: MCP tools registered in `server/world-api/src/mcp-server.ts`

All tools follow the existing pattern: authenticated by ghost credentials, run inside an Effect `ManagedRuntime`, and return a `CallToolResult` with `content[0].text` as JSON.

---

## `eval_contract_open`

Opens a new eval contract. The caller becomes the client; the staked amount is immediately debited from the caller's resource bag.

### Input Schema (Zod)

```typescript
z.object({
  contractorId: z.string().describe("Ghost ID or Group ID of the contractor"),
  evaluatorId:  z.string().describe("Ghost ID of the evaluator"),
  request:      z.string().describe("Opaque request payload (e.g. JSON question spec)"),
  stakeResource: z.string().describe("Resource type to stake (must match a registered resource)"),
  stakeAmount:  z.number().int().nonnegative().describe("Amount to stake from caller's bag (0 is valid; yields zero payout)"),
  deadlineMs:   z.number().int().positive().describe("Absolute deadline as Unix milliseconds"),
})
```

### Success Response

```json
{
  "contractId": "<ULID>",
  "state": "Open",
  "escrowActorId": "escrow:<ULID>",
  "openedAt": 1234567890000
}
```

### Error Cases

- Insufficient funds → `LedgerInsufficientFunds`
- Unknown resource → `LedgerUnknownResource`
- Evaluator is same as contractor → `EvalContractInvalidEvaluator`

---

## `eval_contract_accept`

Contractor accepts an open contract. Caller must be the named contractor (or a member of the named group).

### Input Schema

```typescript
z.object({
  contractId: z.string().describe("ID of the contract to accept"),
})
```

### Success Response

```json
{
  "contractId": "<ULID>",
  "state": "Accepted",
  "beneficiaries": ["ghostA", "ghostB"]  // non-empty only for group contractors
}
```

### Error Cases

- Contract not found → `EvalContractNotFound`
- Wrong state → `EvalContractWrongState`
- Caller not the contractor → `EvalContractNotAuthorized`

---

## `eval_contract_decline`

Contractor declines an open contract. The client's stake is returned from escrow.

### Input Schema

```typescript
z.object({
  contractId: z.string().describe("ID of the contract to decline"),
})
```

### Success Response

```json
{
  "contractId": "<ULID>",
  "state": "Declined"
}
```

### Error Cases

- Contract not found → `EvalContractNotFound`
- Wrong state → `EvalContractWrongState`
- Caller not the contractor → `EvalContractNotAuthorized`

---

## `eval_contract_submit`

Contractor submits a response. Caller must be the named contractor (or a member for group contracts). Submission is immutable once recorded.

### Input Schema

```typescript
z.object({
  contractId:  z.string().describe("ID of the contract"),
  submission:  z.string().describe("Opaque submission payload"),
})
```

### Success Response

```json
{
  "contractId": "<ULID>",
  "state": "Submitted"
}
```

### Error Cases

- Contract not found → `EvalContractNotFound`
- Wrong state → `EvalContractWrongState`
- Deadline passed → `EvalContractDeadlineExpired`
- Caller not the contractor → `EvalContractNotAuthorized`

---

## `eval_contract_evaluate`

Evaluator issues a verdict. Settlement executes atomically immediately after. Caller must be the named evaluator.

### Input Schema

```typescript
z.object({
  contractId: z.string().describe("ID of the contract"),
  verdict:    z.number().min(0).max(1).describe("Score in [0,1]; 0=fail, 1=full payment"),
})
```

### Success Response

```json
{
  "contractId": "<ULID>",
  "state": "Settled",
  "verdict": 0.75,
  "contractorPayment": 75,
  "clientRefund": 25,
  "movements": [
    { "from": "escrow:<ULID>", "to": "ghostContractor", "amount": 75 },
    { "from": "escrow:<ULID>", "to": "clientGhost",     "amount": 25 }
  ]
}
```

(For group contractors, `movements` contains one entry per beneficiary plus the client refund.)

### Error Cases

- Contract not found → `EvalContractNotFound`
- Wrong state → `EvalContractWrongState`
- Caller is not the evaluator → `EvalContractNotAuthorized`
- Caller is the contractor or a beneficiary → `EvalContractInvalidEvaluator`
- Ledger settlement failure → `LedgerError` (propagated)

---

## `eval_contract_get`

Read the current state of a contract. Caller must be the named client, contractor, or evaluator.

### Input Schema

```typescript
z.object({
  contractId: z.string(),
})
```

### Success Response

Full `EvalContract` record as JSON (see `data-model.md`).

### Error Cases

- Contract not found → `EvalContractNotFound`
- Caller is not a party → `EvalContractNotAuthorized`

---

## `eval_contract_list`

List contracts visible to the caller: contracts where the caller is client, contractor, or evaluator.

### Input Schema

```typescript
z.object({
  state: z.enum(["Open","Accepted","Submitted","Evaluated","Settled","Declined","Expired"]).optional(),
})
```

### Success Response

```json
{
  "contracts": [ /* EvalContract[] */ ]
}
```
