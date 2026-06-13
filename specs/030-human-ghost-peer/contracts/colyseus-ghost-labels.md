# Contract: Colyseus ghostLabels schema addition

**Package**: `server/colyseus/src/room-schema.ts`

## Change

Add `ghostLabels: MapSchema<string>` to `WorldSpectatorState`:

```typescript
@type({ map: "string" })
ghostLabels: MapSchema<string> = new MapSchema<string>()
// key: ghostId
// value: comma-separated character gram labels, e.g. "Character:Broker,Character:Npc"
```

## Lifecycle

| Event | Action |
|-------|--------|
| NPC ghost joins room | `state.ghostLabels[ghostId] = labels` (labels from character gram) |
| Ghost leaves room | `delete state.ghostLabels[ghostId]` |
| Human/agent ghost joins | No entry (ghostLabels is only set for labeled NPC ghosts) |

## Label format

Comma-separated gram label tokens matching the character gram syntax. Example:

```
Character:Broker,Character:Npc
```

## Downstream Consumers

| Consumer | How it uses ghostLabels |
|----------|------------------------|
| `clients/intermedium` `useColyseus.ts` | Reads `room.state.ghostLabels[ghostId]` to detect `"Character:Broker"` |
| `GhostList.tsx` | Renders "Broker" badge when label present |
