# Data Model: Eval Contracts Between Ghosts

**Feature**: 024-eval-contracts  
**Date**: 2026-06-04

## Entities

### EvalContract

The primary record. Persisted as a `(:EvalContract)` node in Neo4j, keyed by `id`.

| Field | Type | Notes |
|---|---|---|
| `id` | `EvalContractId` (ULID string) | Assigned at creation; immutable |
| `clientId` | `ActorId` | Ghost who opened the contract |
| `contractorId` | `ActorId \| GroupId` | Ghost or group named as contractor |
| `evaluatorId` | `ActorId` | Ghost who will issue the verdict |
| `request` | `string` | Opaque payload; fixed at Open |
| `submission` | `string \| null` | Opaque payload; null until Submitted; immutable once set |
| `stakeResource` | `ResourceId` | Resource type for the stake |
| `stakeAmount` | `number` | Non-negative integer; 0 is valid (zero-stake contracts settle with zero payout to all parties) |
| `deadline` | `number` | Unix ms; set by client at open time |
| `state` | `EvalContractState` | Lifecycle phase (see below) |
| `verdict` | `number \| null` | v ∈ [0,1]; null until Evaluated |
| `beneficiaries` | `ActorId[]` | Frozen at Accepted (populated for group contractors only) |
| `openedAt` | `number` | Unix ms; set at Open transition |
| `escrowActorId` | `ActorId` | Synthetic: `"escrow:<id>"` |

### EvalContractState (enum)

```
Draft | Open | Accepted | Declined | Submitted | Expired | Evaluated | Settled
```

### State Transitions

```
Draft ──► Open ──► Accepted ──► Submitted ──► Evaluated ──► Settled
              │           │                                     ▲
              └──► Declined└──► Expired ──────────────────────┘
                   (escrow       (deadline; v=0)
                    returned)
```

| From | To | Trigger | Side effects |
|---|---|---|---|
| Draft | Open | `openContract()` | Ledger: `clientBag → escrow`; register escrow actor |
| Open | Accepted | `acceptContract()` | Freeze beneficiary list if group contractor |
| Open | Declined | `declineContract()` | Ledger: `escrow → clientBag` |
| Accepted | Submitted | `submitContract()` | Record submission; immutable from this point |
| Accepted | Expired | deadline passes (checked on access or by timer) | Ledger: `escrow → clientBag` |
| Submitted | Evaluated | `evaluateContract()` | Record verdict |
| Evaluated | Settled | triggered by `evaluateContract()` immediately after | Ledger: settlement movements |

## Neo4j Node Shape

```
(:EvalContract {
  id: string,             // ULID
  clientId: string,
  contractorId: string,
  evaluatorId: string,
  request: string,        // opaque JSON string
  submission: string,     // opaque JSON string or null
  stakeResource: string,
  stakeAmount: integer,
  deadline: integer,      // Unix ms
  state: string,          // EvalContractState
  verdict: float,         // null until Evaluated
  beneficiaries: string[],// empty array until Accepted (group contractor only)
  openedAt: integer,      // Unix ms
  escrowActorId: string,
})
```

No relationships to other nodes are required; contract IDs reference actors by their string IDs, consistent with the pattern used by `LedgerEntry` nodes.

## Shared Types (additions to `shared/types/src/`)

New file: `shared/types/src/eval-contract.ts`

```typescript
export type EvalContractId = string;

export type EvalContractState =
  | "Draft"
  | "Open"
  | "Accepted"
  | "Declined"
  | "Submitted"
  | "Expired"
  | "Evaluated"
  | "Settled";

export interface EvalContract {
  id: EvalContractId;
  clientId: string;       // ActorId
  contractorId: string;   // ActorId | GroupId
  evaluatorId: string;    // ActorId
  request: string;
  submission: string | null;
  stakeResource: string;  // ResourceId
  stakeAmount: number;
  deadline: number;       // Unix ms
  state: EvalContractState;
  verdict: number | null;
  beneficiaries: string[]; // ActorId[]
  openedAt: number;
}
```

Export from `shared/types/src/index.ts`.
