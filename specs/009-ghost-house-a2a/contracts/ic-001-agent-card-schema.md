# IC-001: Agent Card Schema

**Status**: Accepted  
**Consumers**: Ghost house catalog service (validates on registration), TCK (validates per tier), contributed agents (must produce), ghost-cli (may display)  
**Source of truth**: [RFC-0007 §Agent Card Schema](../../../proposals/rfc/0007-ghost-house-architecture.md)  
**Supersedes**: [IC-009 (spike-008)](../../008-a2a-ghost-house-spike/contracts/ic-009-rfc-0007-agent-card-field-matrix.md) — spike validation artifact; this is the production contract

## Purpose

Define the complete agent card format that ghost agents must publish at `/.well-known/agent-card.json` and submit at catalog registration. The card extends the standard A2A agent card with a `matrix` top-level object carrying all Matrix-specific metadata.

## Schema

```json
{
  "name": "random-agent",
  "description": "Reference Wanderer agent: random movement, no memory, no speech.",
  "protocolVersion": "0.3.0",
  "version": "0.1.0",
  "url": "http://localhost:4001",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "wander",
      "name": "Wander",
      "description": "Move to a random adjacent cell each tick"
    }
  ],
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],

  "matrix": {
    "schemaVersion": 1,
    "tier": "wanderer",
    "ghostClasses": ["any"],
    "requiredTools": ["whereami", "exits", "go"],
    "capabilitiesRequired": [],
    "memoryKind": "none",
    "llmProvider": "none",
    "profile": {
      "about": "The simplest possible ghost. Moves at random, never speaks, never listens."
    },
    "authors": ["@akollegger"]
  }
}
```

## Field Rules

### Standard A2A fields (all required)

| Field | Type | Rule |
|-------|------|------|
| `name` | string | Non-empty; used as display name in catalog |
| `description` | string | Non-empty |
| `protocolVersion` | string | Must be `"0.3.0"` for this feature version |
| `version` | string | SemVer; agent's own release version |
| `url` | string | Reachable base URL; house fetches agent card from `{url}/.well-known/agent-card.json` |
| `capabilities.streaming` | boolean | Wanderer: `true` (required for movement loop); Listener/Social: `true` |
| `capabilities.pushNotifications` | boolean | Wanderer: `false`; Listener/Social: `true` |
| `skills` | array | At least one skill entry with `id`, `name`, `description` |
| `defaultInputModes` | string[] | `["text"]` minimum |
| `defaultOutputModes` | string[] | `["text"]` minimum |

### `matrix` extension (all fields required for catalog acceptance)

| Path | Type | Rule |
|------|------|------|
| `matrix.schemaVersion` | number | Must be `1` for this RFC revision |
| `matrix.tier` | string | One of `"wanderer"`, `"listener"`, `"social"` |
| `matrix.ghostClasses` | string[] | Non-empty; `["any"]` or list of supported ghost class names |
| `matrix.requiredTools` | string[] | MCP tool names from IC-003; house validates availability at registration |
| `matrix.capabilitiesRequired` | string[] | House capability IDs; may be empty (`[]`) |
| `matrix.memoryKind` | string | Descriptive only; any string; `"none"` if agent has no memory |
| `matrix.llmProvider` | string | Descriptive only; any string; `"none"` if agent uses no LLM |
| `matrix.profile.about` | string | Non-empty; shown in catalog UI |
| `matrix.authors` | string[] | Non-empty; GitHub handles or names |

## Tier–Capability Consistency Rules

The house rejects registration if the declared tier is inconsistent with `capabilities`:

| Tier | `capabilities.streaming` | `capabilities.pushNotifications` |
|------|--------------------------|----------------------------------|
| `wanderer` | `true` | `false` |
| `listener` | `true` | `true` |
| `social` | `true` | `true` |

## TCK Validation

The TCK validates this contract by:
1. Fetching `{agentBaseUrl}/.well-known/agent-card.json`
2. Asserting all required fields are present and correctly typed
3. Asserting `matrix.schemaVersion === 1`
4. Asserting tier–capability consistency per table above
5. Asserting `matrix.requiredTools` is a subset of IC-003 tool names

## Downstream Consumers

- **Ghost house catalog service**: validates on `POST /v1/catalog/register`
- **Agent supervisor**: reads `matrix.tier`, `matrix.requiredTools`, `matrix.capabilitiesRequired` at spawn
- **Ghost-cli**: may display `matrix.profile.about` and `matrix.authors` in catalog listings
- **TCK**: validates per tier
