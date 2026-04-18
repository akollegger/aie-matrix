# Data Model: Ghost CLI

**Feature**: `004-ghost-cli` | **Phase 1 output**

---

## Core types

### `GhostConfig`

Resolved once at startup by the `@effect/cli` `Config` layer; used by pre-flight and the MCP service layer.

| Field | Type | Source (precedence order) |
|-------|------|--------------------------|
| `token` | `string` | `--token` flag → `GHOST_TOKEN` env → `.env` file |
| `url` | `string` | `--url` flag → `WORLD_API_URL` env → `.env` file |
| `debug` | `boolean` | `--debug` flag (default: false) |
| `json` | `boolean` | `--json` flag (default: false) |

---

### `PreFlightResult`

Produced by each of the three pre-flight phases. A phase that passes produces `PreFlightResult.Pass`; a failing phase short-circuits the sequence with a structured `PreFlightResult.Fail`.

```
PreFlightResult
  Pass
  Fail
    phase:   "env-scan" | "reachability" | "handshake"
    error:   PreFlightError  (see below)
    message: string          (human-readable, never a stack trace)
    remedy:  string          (the single concrete next step, or empty)
```

---

### `PreFlightError` (discriminated union)

| Tag | Fields | Stance |
|-----|--------|--------|
| `PreFlight.EnvMissingToken` | `{ inRepoRoot: boolean }` | Guided resolution |
| `PreFlight.EnvMissingUrl` | `{ hasEnvFile: boolean }` | Guided resolution |
| `PreFlight.UrlMissingMcpSuffix` | `{ url: string }` | Guided resolution |
| `PreFlight.ServerUnreachable` | `{ host: string; port: number; errno: string }` | Guided resolution |
| `PreFlight.HostNotFound` | `{ host: string }` | Guided resolution |
| `PreFlight.McpEndpointNotFound` | `{ url: string }` | Guided resolution |
| `PreFlight.TokenRejected` | `{}` | Guided resolution |
| `PreFlight.GhostNotFound` | `{}` | Guided resolution |
| `PreFlight.UnknownNetworkError` | `{ url: string; detail: string }` | Informative blocking |

---

### `ConnectionState`

Held in an Effect `Ref`; drives the status strip color and label in interactive mode.

| Variant | Status strip label | Color |
|---------|--------------------|-------|
| `Connected { ghostId, tileId, serverAddr }` | `● CONNECTED` | Green |
| `Reconnecting { attempt, maxAttempts, retryInMs }` | `◌ RECONNECTING` | Yellow |
| `Disconnected` | `✗ DISCONNECTED` | Red |
| `TokenExpired` | `⚠ TOKEN EXPIRED` | Red |

---

### `GhostIdentity`

Returned by `whoami` and cached in a Ref for the Ghost panel.

| Field | Type | Source |
|-------|------|--------|
| `ghostId` | `string` | `whoami` MCP response |
| `displayName` | `string \| undefined` | optional from response |

---

### `GhostPosition`

Returned by `whereami` and updated after each `go` command.

| Field | Type | Source |
|-------|------|--------|
| `tileId` | `string` | `whereami` response |
| `col` | `number` | `whereami` response |
| `row` | `number` | `whereami` response |

---

### `TileView`

Returned by `look { at: "here" }` and displayed in the World View panel.

| Field | Type | Notes |
|-------|------|-------|
| `tileId` | `string` | current tile ID |
| `tileClass` | `string` | e.g., "Cyan" |
| `occupants` | `string[]` | ghost IDs present |
| `prose` | `string` | human-readable render for World View panel |

---

### `ExitList`

Returned by `exits` and displayed in the Exits panel.

| Field | Type | Notes |
|-------|------|-------|
| `exits` | `{ toward: string; tileId: string }[]` | ordered list of navigable exits |

---

### `LogEntry`

Written to the scrolling log strip in interactive mode; also used for structured output in one-shot debug mode.

| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | `Date` | time of event |
| `kind` | `"command" \| "movement" \| "connection" \| "diagnostic"` | log category |
| `message` | `string` | human-readable text |

Movement denials are `kind: "movement"` with message like `"blocked: no tile to the nw (NO_NEIGHBOR)"`.
Infrastructure failures are `kind: "connection"` or `kind: "diagnostic"`.

---

### `ReplCommand` (discriminated union)

The result of parsing a single line of REPL input.

| Tag | Arguments |
|-----|-----------|
| `whoami` | — |
| `whereami` | — |
| `look` | `at: "here" \| "around" \| Face` |
| `exits` | — |
| `go` | `toward: Face` |
| `help` | — |
| `exit` | — |
| `unknown` | `raw: string` |

Where `Face = "n" | "s" | "ne" | "nw" | "se" | "sw"`.

---

## State topology (interactive mode)

In interactive mode the following Effect `Ref` values are maintained and observed by Ink components:

| Ref | Type | Updated by |
|-----|------|-----------|
| `connectionStateRef` | `Ref<ConnectionState>` | MCP reconnect fiber |
| `identityRef` | `Ref<GhostIdentity \| null>` | `whoami` handler |
| `positionRef` | `Ref<GhostPosition \| null>` | `whereami` + `go` handlers |
| `tileViewRef` | `Ref<TileView \| null>` | `look here` handler (auto-called after `go`) |
| `exitsRef` | `Ref<ExitList \| null>` | `exits` handler (auto-called after `go`) |
| `logRef` | `Ref<LogEntry[]>` | all command handlers + connection events |
