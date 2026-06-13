# Data Model: Human Participation as Ghost Peer

## HumanIdentity (browser-local, localStorage)

| Field | Type | Notes |
|-------|------|-------|
| `ghostId` | string (ULID) | Generated on first visit; stable across reloads |
| `displayName` | string | Auto-generated; editable once; locked after edit |
| `nameEdited` | boolean | `false` until user edits; gates further edits |

No server-side persistence. The ghostId serves as the ledger `actorId` — the bag exists in the ledger once a spawn-grant transaction is committed.

## GuestJWT (in-memory, session only)

| Claim | Value |
|-------|-------|
| `sub` | ghostId |
| `ghostId` | ghostId |
| `role` | `"human"` |
| `exp` | issued + 8h |

Not persisted to localStorage (XSS mitigation). Re-issued on page load.

## ActiveContract (client-side view, derived from EvalContract)

| Field | Source |
|-------|--------|
| `contractId` | `EvalContract.id` |
| `question` | Parsed from `EvalContract.request` (JSON: `{ question: string }`) |
| `state` | `EvalContract.state` |
| `deadline` | `EvalContract.deadline` (unix ms) |
| `brokerGhostId` | `EvalContract.clientId` |
| `stakeAmount` | `EvalContract.stakeAmount` |
| `stakeResource` | `EvalContract.stakeResource` |

Derived by polling `eval_contract_list` and filtering for `contractorId === humanGhostId` and `state` in `["Open", "Accepted", "Submitted"]`.

## GhostLabels (Colyseus room state, server-authoritative)

| Key | Value |
|-----|-------|
| `ghostId` (string) | Comma-separated gram labels (string) |

Example: `{ "01JX...npc1": "Character:Broker,Character:Npc" }`

Cleared on ghost leave. Human ghosts have no entry.

## State Transitions (ActiveContract lifecycle in client)

```
[no contract]
     │  broker sends "accept" response with contractId
     ▼
  Open ──► chat input replaced by submission form
     │  attendee submits answer
     ▼
 Submitted ──► form shows "waiting for evaluation"
     │  broker evaluates (auto-pass)
     ▼
 Settled ──► form cleared; balance updated; normal chat restored
     │
     ├─ Expired ──► "challenge expired" message; normal chat restored
     └─ Declined ──► "fully booked" message; normal chat restored
```
