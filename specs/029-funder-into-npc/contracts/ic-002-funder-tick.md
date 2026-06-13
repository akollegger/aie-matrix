# IC-002: `funderTick` function signature

**Contract**: The `funderTick` function is the single entry point called by `ghostActionLoop` on each tick for a funder-kind character.

**Signature**:
```ts
export async function funderTick(ghostId: string, mcp: GhostMcpClient): Promise<void>
```

**Behavior**:
1. Calls `mcp.callTool("inbox", {})` to drain pending messages.
2. For each notification, applies the funder state machine:
   - `idle` → replies with advertisement; on "accept", calls `eval_contract_open` and transitions to `awaiting_submission`.
   - `awaiting_submission` → no inbox action needed (contract evaluation triggered by world event, not inbox).
3. Returns `Promise<void>` whether or not any messages were processed.
4. Throws only on unrecoverable MCP connection errors (non-fatal errors are caught internally and logged).

**Called from**: `ghostActionLoop` tick, inside the existing `tryPromise` wrapper.  
**Module**: `ghosts/npc-agent/src/behavior/funder-behavior.ts`
