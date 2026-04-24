# IC-008: Spike B Synthetic World Event (Minimal Shape)

**Status**: Draft (spike-only)  
**Consumers**: Spike B house → sample agent push path; Spike B report appendix  
**Normative RFC**: [`proposals/rfc/0007-ghost-house-architecture.md`](../../../proposals/rfc/0007-ghost-house-architecture.md) (diff actual payloads against future house↔agent contracts)

## Purpose

Define the **minimal** JSON envelope the skeleton house sends as a stand-in for a Colyseus-sourced world event, so Spike B satisfies `spec.md` FR-007 and IC-002 with a stable example for the report.

This is **not** a production world contract.

## Envelope

```json
{
  "schema": "aie-matrix.spike.synthetic-world-event.v1",
  "eventId": "01JXXXX",
  "kind": "demo.world.tick",
  "payload": {
    "message": "Hello from skeleton house"
  },
  "sentAt": "2026-04-24T12:00:00.000Z"
}
```

### Field rules

| Field | Required | Notes |
|--------|----------|--------|
| `schema` | yes | Literal for report diffs; implementers may use ULID for `eventId`. |
| `eventId` | yes | Unique per send. |
| `kind` | yes | Fixed to `demo.world.tick` for spike unless report documents a variant. |
| `payload` | yes | Arbitrary JSON; keep tiny. |
| `sentAt` | yes | ISO-8601 UTC. |

## Agent response capture

The sample agent SHOULD reply with a JSON body containing at least:

```json
{
  "schema": "aie-matrix.spike.agent-response.v1",
  "inReplyTo": "01JXXXX",
  "received": true,
  "note": "freeform"
}
```

Implementers MAY use A2A-native wrappers; the report must paste **the on-wire JSON** the house observes, whatever shape the SDK uses.
