# IC-002: A2A Conversation Subscription (Human Spectator Side)

**Contract ID**: IC-002  
**Feature**: `011-intermedium-client`  
**Status**: Gap — MVP uses placeholder stub  
**Related**: [RFC-0008 §Open Question 2](../../../proposals/rfc/0008-human-spectator-client.md), [RFC-0007](../../../proposals/rfc/0007-ghost-house-architecture.md), [IC-002 (spec-009)](../../009-ghost-house-a2a/contracts/ic-002-a2a-protocol.md)  
**Consumers**: `clients/intermedium/src/hooks/useA2AConversation.ts`

## Purpose

Documents the interface the intermedium needs from the ghost house to read and write the paired-ghost conversation thread. This contract is a **gap artifact** — the exact mechanism is not yet defined by the ghost house team. This document records the expected contract shape so the ghost house team can design to it, and so the intermedium can be implemented against a stub in the meantime.

## Context

RFC-0007 and ADR-0004 establish that the ghost house manages conversation threads via A2A. The A2A protocol (IC-002 in spec-009) is designed for agent-to-agent interaction; the intermedium is a browser client, not an A2A agent. The ghost house must expose a separate, browser-accessible interface for human spectators to read and write conversation history.

## Expected Contract Shape (target)

The ghost house MUST expose the following HTTP routes for human spectator access:

### Read conversation history

```
GET /conversation/:ghostId/messages
```

**Query parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `since` | string (ISO 8601) | Optional. Only return messages after this timestamp. |
| `limit` | number | Optional. Maximum messages to return. Default: 50. |

**Response `200 OK`**:

```json
{
  "ghostId": "ghost-uuid",
  "messages": [
    {
      "messageId": "01JXXXXXXXXXXXXXXXXXXXXXXXXX",
      "sender": "ghost",
      "content": "Hello, I found an artefact near the registration desk.",
      "timestamp": "2026-06-10T14:22:00Z"
    },
    {
      "messageId": "01JXXXXXXXXXXXXXXXXXXXXXXXXY",
      "sender": "human",
      "content": "What does it do?",
      "timestamp": "2026-06-10T14:22:30Z"
    }
  ]
}
```

### Send a message

```
POST /conversation/:ghostId/messages
Content-Type: application/json
```

**Request body**:

```json
{
  "content": "What does it do?"
}
```

**Response `201 Created`**:

```json
{
  "messageId": "01JXXXXXXXXXXXXXXXXXXXXXXXXY",
  "sender": "human",
  "content": "What does it do?",
  "timestamp": "2026-06-10T14:22:30Z"
}
```

### Live updates (preferred)

```
GET /conversation/:ghostId/stream
```

Server-Sent Events stream. Each event is a `ConversationMessage` JSON object. The intermedium subscribes to this stream at Partner and Neighbor scale (when the paired ghost is in proximity).

**Alternative**: WebSocket upgrade on the same path. Either is acceptable; SSE is preferred for simplicity in a browser context.

## MVP Stub Behaviour

Until the ghost house team implements this API:

1. The intermedium attempts `GET /conversation/:ghostId/messages`.
2. If the response is `404` or the connection fails, `ConversationThread.isAvailable` is set to `false`.
3. The Partner scale panel renders a placeholder: *"Conversation not yet available — ghost house API pending."*
4. Sending a message is disabled (the input field is shown but grayed out with a tooltip).

## Authentication

The conversation routes MUST verify that the requesting human is paired with the specified `ghostId`. MVP mechanism: same static bearer token as agent-to-house auth (`GHOST_HOUSE_DEV_TOKEN`), passed as `Authorization: Bearer <token>`. Production: session token tied to the attendee pairing record.

## Invariants

- The intermedium MUST NOT impersonate an A2A agent to access conversation history.
- Messages sent by the human MUST be distinguishable from messages sent by the ghost (`sender: "human"` vs `sender: "ghost"`).
- The intermedium MUST only subscribe to the conversation of its own paired ghost.

## Downstream Consumers

| Consumer | Usage |
|----------|-------|
| `clients/intermedium` | Read thread at Partner/Neighbor scale; send messages at Partner scale |
| Ghost house A2A task handler | Receives human messages as interrupts to the paired ghost's streaming task |
