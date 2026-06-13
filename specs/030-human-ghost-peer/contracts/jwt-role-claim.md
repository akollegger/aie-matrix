# Contract: JWT GhostClaims role field

**Package**: `server/world-api/src/jwt.ts`

## Change

Add `role?: string` to `GhostClaims`:

```typescript
export interface GhostClaims {
  sub: string
  ghostId: string
  role?: string          // NEW — "human" for guest tokens; absent for agent-issued tokens
  caretakerId?: string
  agentHostId?: string
  agentId?: string
}
```

## Semantics

| Value | Meaning |
|-------|---------|
| `"human"` | Issued by `POST /auth/guest`; proximity exemption for directed `say()`; spawn-grant tier `human` |
| absent / undefined | Ghost agent issued by agent-host; role resolved from agent catalog (existing behavior) |

## Downstream Consumers

| Consumer | How it uses `role` |
|----------|--------------------|
| `auth-context.ts` | Copies `claims.role` into `auth.extra.role` |
| `mcp-server.ts` spawn-grant | Reads `authExtra.role` to select `:Grants` tier; already has `?? "attendee"` fallback |
| `mcp-server.ts` `sayEffect()` | Reads `authExtra.role` and passes as `callerRole` to `conversation.say()` |
| `ConversationServiceLive` | Uses `callerRole === "human"` to skip position check on directed messages |
