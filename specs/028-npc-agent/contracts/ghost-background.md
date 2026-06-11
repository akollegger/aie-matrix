# Contract IC-008: Per-Ghost `background` Field

**Owner**: `server/registry` (storage) + `server/agent-host` (spawn context) · **Additive**.

## Current state

Only `displayName` is per-ghost ([registry/src/routes/adoption.ts:101](../../../server/registry/src/routes/adoption.ts), persisted at `registry-store-model.ts:31`). A ghost's `about`/background is per-**agent** in the AgentCard (`buildAgentCard.ts:31`) and cannot distinguish characters that share one agent — so NPC characters cannot have distinct inspectable backgrounds today.

## Change (additive, optional field)

1. **Adoption payload** (`POST /registry/adopt` and admin `/registry/ghosts`): accept optional `background: string`.
2. **Registry ghost record** (`registry-store-model.ts`): persist optional `background`.
3. **`SpawnContext.ghostCard`** (`server/agent-host/src/types.ts` + `ghosts/*/src/spawn-types.ts`): add optional `background` (and `characterId`, used by the npc-agent executor).
4. **Read paths**: `whereami` / ghost-profile reads surface `background` alongside `displayName` (`mcp-server.ts:783`), and cross-pod reads via `GET /registry/ghosts/:id`.

### Shape

```jsonc
// adoption request (additions only)
{ "ghostId": "...", "displayName": "Ada the Info Attendant", "background": "Stationed at the info booth." }

// SpawnContext.ghostCard (additions only)
{ "class": "...", "displayName": "...", "partnerEmail": "...",
  "background": "Stationed at the info booth.", "characterId": "info-attendant" }
```

## Compatibility

`background` is optional and defaults to absent/empty — existing adopters and agents (random, funder) are unaffected. Consumers MUST treat a missing `background` as "none". Satisfies spec US1 scenario 2 ("name and background visible").
