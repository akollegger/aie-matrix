# Data Model: Effect-ts Transition

**Branch**: `002-effect-ts-transition` | **Phase 1 Output**

This document describes the services, error types, and data shapes introduced by the Effect-ts transition. It is not a database schema — all state remains in-memory (RegistryStore) or in Colyseus (room schema).

---

## Services (Context.Tag)

### WorldBridgeService

The coordinator that bridges the stateless World-API and the stateful Colyseus Room. Wraps the existing `ColyseusWorldBridge` interface verbatim.

```typescript
interface WorldBridgeService {
  getLoadedMap(): LoadedMap
  getGhostCell(ghostId: string): string | undefined
  setGhostCell(ghostId: string, cellId: string): void
  listOccupantsOnCell(cellId: string): string[]
}
```

**Tag**: `"aie-matrix/WorldBridgeService"`  
**Layer**: `Layer.succeed(WorldBridgeService, bridge)` — provided after Colyseus initialises  
**Consumers**: `handleGhostMcpRequest`, MCP tool handlers (`go`, `whereami`, `look`, `exits`), `spawnGhostOnMap`

### RegistryStoreService

The authority on ghost identities, adoptions, and caretaker associations. Wraps the existing `RegistryStore` (plain Map-based object).

```typescript
interface RegistryStoreService {
  caretakers: Map<string, Caretaker>
  ghostHouses: Map<string, GhostHouse>
  ghosts: Map<string, Ghost>
}
```

**Tag**: `"aie-matrix/RegistryStoreService"`  
**Layer**: `Layer.succeed(RegistryStoreService, store)` — constructed at startup  
**Consumers**: registry route handlers, `adoptGhost`, `spawnGhostOnMap`

### TranscriptHub

Fan-out hub for IRL event transcripts. Decouples the ingestion source from the 5,000 ghost subscribers.

```typescript
// Service type is PubSub<TranscriptEvent>
interface TranscriptEvent {
  source: string      // e.g. "stage-a", "panel-b"
  text: string        // raw transcript segment
  timestamp: number   // epoch ms
}
```

**Tag**: `"aie-matrix/TranscriptHub"`  
**Layer**: `PubSub.dropping<TranscriptEvent>(256)` wrapped in `Layer.scoped` with a shutdown finaliser  
**Consumers**: transcript ingestion publisher, per-ghost subscriber fibers

### ServerConfigService

Typed access to environment-derived configuration values. Eliminates bare `const` declarations scattered through `main()`.

```typescript
interface ServerConfigService {
  httpPort: number
  mapPath: string
  mapsRoot: string
  corsHeaders: Record<string, string>
  debugEnabled: boolean
}
```

**Tag**: `"aie-matrix/ServerConfigService"`  
**Layer**: `Layer.succeed(ServerConfigService, config)` — derived from `process.env` at startup

---

## Error Types (Data.TaggedError)

### AuthError

Covers JWT verification and auth context extraction failures.

```typescript
class AuthError extends Data.TaggedError("AuthError")<{
  readonly variant: "MissingCredentials" | "InvalidToken" | "MalformedClaims" | "ExpiredToken"
  readonly detail?: string
}> {}
```

**Replaces**: silent `undefined` return in `auth-context.ts`, `throw new Error(...)` in `requireGhostAuth`, `throw` in `jwt.ts`  
**HTTP mapping**: 401

### RegistryError

Domain errors for the registry adoption and registration flows.

```typescript
class RegistryError extends Data.TaggedError("RegistryError")<{
  readonly code: "UnknownCaretaker" | "UnknownGhostHouse" | "CaretakerAlreadyHasGhost"
  readonly message: string
}> {}
```

**Replaces**: `throw new RegistryConflictError(...)` in `session-guard.ts` and route handlers  
**HTTP mapping**: 409 (all variants)

### WorldApiError

Domain errors originating from MCP tool handlers (world-api package).

```typescript
class WorldApiError extends Data.TaggedError("WorldApiError")<{
  readonly code: "NoPosition" | "UnknownCell" | "MapIntegrity" | "MovementBlocked"
  readonly message: string
  readonly ghostId?: string
  readonly cellId?: string
}> {}
```

**Replaces**: per-tool `try/catch → toolError()` in `mcp-server.ts`  
**HTTP mapping**: `NoPosition` → 404; `UnknownCell` → 404; `MapIntegrity` → 500; `MovementBlocked` → 422

### WorldBridgeError

Errors from the orchestration layer when the world bridge is unavailable or the map is in an invalid state.

```typescript
class WorldBridgeError extends Data.TaggedError("WorldBridgeError")<{
  readonly variant: "NotReady" | "NoNavigableCells"
}> {}
```

**Replaces**: `throw new Error("World bridge not ready")` and `throw new Error("Map has no navigable cells")` in `index.ts`  
**HTTP mapping**: 503

### McpHandlerError

Wrapper for unexpected failures inside the MCP request lifecycle (not domain errors — those use WorldApiError).

```typescript
class McpHandlerError extends Data.TaggedError("McpHandlerError")<{
  readonly cause: unknown
}> {}
```

**Replaces**: outer `try/catch` block in the `/mcp` POST route in `index.ts`  
**HTTP mapping**: 500

---

## State Transitions

### Ghost Lifecycle (unchanged)

```
Unadopted → Adopted (POST /registry/adopt) → Spawned (setGhostCell called)
                                              ↓
                                    Moving (go MCP tool)
                                              ↓
                                    Subscribed to TranscriptHub (forkScoped)
```

The Effect transition does not change these transitions; it makes the error cases explicit and the dependency on `WorldBridgeService` typed rather than implicit.

### TranscriptHub Subscription Lifecycle

```
Ghost adopted → subscribeGhostToHub(ghostId) forked as scoped fiber
                ↓
        Waiting on Queue.take(dequeue)
                ↓
        PubSub.publish(hub, event) received
                ↓
        notifyGhost(ghostId, event) executed
                ↓
        Back to waiting (Effect.forever loop)
                
Ghost disconnects → enclosing Scope closes → fiber interrupted → dequeue finalised
```

---

## Validation Rules

- `ghostId`: non-empty string, trimmed (enforced at bridge boundary — unchanged)
- `cellId`: must exist in `LoadedMap.cells` (enforced in `WorldApiError.UnknownCell`)
- `TranscriptEvent.source`: non-empty string
- `TranscriptEvent.text`: non-empty string
- `TranscriptEvent.timestamp`: positive integer (epoch ms)
- Auth token: Bearer JWT with `sub` (ghostId) and `caretakerId` claims — enforced by `AuthError` variants

---

## Entity Relationships

```
ServerConfigService ──► (read-only by all handlers)

RegistryStoreService
  ├── caretakers: Map<caretakerId, Caretaker>
  ├── ghostHouses: Map<houseId, GhostHouse>
  └── ghosts: Map<ghostId, Ghost { tileId, caretakerId, houseId }>

WorldBridgeService
  ├── wraps ColyseusWorldBridge (delegates to MatrixRoom — untouched)
  └── ghostAuthority: Map<ghostId, cellId>  ← authority cache (lives in bridge service)

TranscriptHub: PubSub<TranscriptEvent>
  └── subscriptions: one Queue<TranscriptEvent> per adopted ghost (scoped fiber)
```
