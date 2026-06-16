# Data Model: Ghost Agent Autospawning

No new persistent entities. This feature is purely additive behavior on existing entities.

## Affected entities

### CatalogEntry (existing, `server/agent-host/src/types.ts`)

The `agentCard.matrix.rosterAgent` boolean flag is set to `true` for random-agent.  
No schema change — the field already exists and is used by npc-agent.

### RosterEntry (existing shape, no new type)

Both `/v1/roster` endpoints return `Array<RosterEntry>`:

```ts
type RosterEntry = {
  characterId: string;   // stable ID within this agent's roster
  displayName: string;   // human-readable label
  background?: string;   // optional flavor text (used by NPC, omitted for wanderers)
}
```

random-agent generates these synthetically from `RANDOM_AGENT_COUNT`; npc-agent loads them from `.character.gram` files. No type change required in either package.

## Configuration

| Variable | Package | Default | Purpose |
|---|---|---|---|
| `RANDOM_AGENT_COUNT` | `ghosts/random-agent` | `10` | Number of wanderer roster entries |
| `AGENT_HOST_DISABLE_RECONCILIATION` | `server/agent-host` | unset (enabled) | Opt-out for tests/local dev that don't want auto-spawn on startup |
