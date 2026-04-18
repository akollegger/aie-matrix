# IC-004: GhostClientService — Effect Service Interface

**Feature**: `004-ghost-cli`
**Consumer**: `@aie-matrix/ghost-cli` (internal to the package)
**Provider**: `GhostClientLayer` wrapping `@aie-matrix/ghost-ts-client`

---

## Purpose

`GhostClientService` is the Effect service boundary between the CLI's command logic and the underlying MCP transport. All MCP tool calls within the CLI go through this service; no code outside `GhostClientLayer` touches `GhostMcpClient` directly.

---

## Service interface

```typescript
interface GhostClientServiceInterface {
  /**
   * Call an MCP ghost tool by name with optional arguments.
   * Returns the parsed tool result on success.
   * Yields a typed GhostClientError on failure (network, protocol, or tool error).
   */
  callTool(
    name: GhostToolName,
    args?: Record<string, unknown>
  ): Effect.Effect<unknown, GhostClientError>
}
```

### `GhostToolName`

Constrained to the five tools defined in IC-003:

```typescript
type GhostToolName = "whoami" | "whereami" | "look" | "exits" | "go"
```

---

## Error type: `GhostClientError`

All failures from the MCP transport surface as one of these variants:

| Tag | Meaning | Stance |
|-----|---------|--------|
| `GhostClient.NetworkError` | TCP/HTTP failure during tool call | Self-healing (retry) |
| `GhostClient.ProtocolError` | MCP handshake or protocol violation | Informative blocking |
| `GhostClient.ToolError` | Tool returned `isError: true` (movement deny, unknown cell) | Caller interprets |

`GhostClient.ToolError` carries `{ code: string; message: string }` extracted from the MCP error text. The caller (command handler) maps domain codes (`RULESET_DENY`, `NO_NEIGHBOR`, `UNKNOWN_CELL`) to log entries; infrastructure codes surface in the status strip.

---

## Lifecycle

`GhostClientLayer` is `Layer.scoped`:
- **Acquire**: creates a `GhostMcpClient`, calls `connect()`, wraps in the service interface
- **Release**: calls `disconnect()` on runtime disposal (SIGTERM, normal exit)

The layer depends on `GhostConfig` (resolved by `@effect/cli`'s `Config` layer).

---

## Reconnect contract

The CLI implements reconnect logic above the `GhostClientService` layer. When a `GhostClient.NetworkError` is caught by the reconnect fiber, the fiber:
1. Updates `connectionStateRef` to `Reconnecting`
2. Disposes and re-acquires the `GhostClientLayer` scope
3. Re-runs pre-flight phases 2 and 3 before resuming

This keeps the reconnect concern outside `GhostClientService`, which is stateless once connected.

---

## Related

- [IC-003](../../001-minimal-poc/contracts/ghost-mcp.md) — the five MCP tool schemas this service calls
- [data-model.md](../data-model.md) — `GhostClientError` variants and `GhostToolName` type
