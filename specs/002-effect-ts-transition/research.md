# Research: Effect-ts Transition

**Branch**: `002-effect-ts-transition` | **Phase 0 Output**

---

## 1. Service Layer Pattern

**Decision**: Use `Context.Tag` class with a factory function returning `Layer.succeed` for services backed by already-constructed objects (like `ColyseusWorldBridge`). Use `Layer.scoped` + `Effect.acquireRelease` for services with async startup/shutdown (like Colyseus itself in Phase 2).

```typescript
// Minimal service definition
export class WorldBridgeService extends Context.Tag("aie-matrix/WorldBridgeService")<
  WorldBridgeService,
  ColyseusWorldBridge   // re-use existing interface verbatim
>() {}

// Layer construction after Colyseus initialises
export const makeWorldBridgeLayer = (bridge: ColyseusWorldBridge) =>
  Layer.succeed(WorldBridgeService, bridge)

// Consumption
const handler = Effect.gen(function* () {
  const bridge = yield* WorldBridgeService
  return bridge.getGhostCell(ghostId)
})
```

**Rationale**: `Context.Tag` is the single canonical DI primitive in Effect. The tag string is the unique discriminant at runtime; type parameters give full compile-time safety — TypeScript refuses to `runPromise` any `Effect` that still has an unresolved service in its `R` channel. This eliminates the `let bridge: ... | undefined` + `if (!bridge)` pattern throughout `index.ts`.

**Alternatives considered**:
- Raw closure passing (current): works but TypeScript cannot enforce initialisation order.
- Global module singleton (`export let bridge`): same undefined race, not testable.
- Class-based DI containers (tsyringe, InversifyJS): solves DI but adds a separate framework with no typed error or concurrency integration.

---

## 2. Typed Error Channels

**Decision**: Use `Data.TaggedError` for all domain errors. Yield errors directly in `Effect.gen` (yieldable errors — no `Effect.fail` wrapper needed). Map to HTTP status codes at the handler boundary using `Effect.catchAll` + `Match.tag`.

```typescript
export class GhostNotFoundError extends Data.TaggedError("GhostNotFound")<{
  readonly ghostId: string
}> {}

export class WorldNotReadyError extends Data.TaggedError("WorldNotReady")<{}> {}

// Inside a handler — yieldable
const cell = bridge.getGhostCell(ghostId)
if (!cell) yield* new GhostNotFoundError({ ghostId })

// HTTP boundary mapping
const errorToResponse = (e: GhostNotFoundError | WorldNotReadyError | ...) =>
  Match.value(e).pipe(
    Match.tag("GhostNotFound", () => ({ status: 404, body: `Ghost ${e.ghostId} not found` })),
    Match.tag("WorldNotReady", () => ({ status: 503, body: "World initialising" })),
    Match.exhaustive
  )
```

**Rationale**: `Data.TaggedError` gives three things simultaneously: a `_tag` string discriminant for `catchTag`/`Match.tag`, automatic equality and `toString`, and `yield*` semantics inside `Effect.gen`. The full error union is automatically maintained by TypeScript as you compose effects, so the compiler warns at the mapping site if a new error type is added without a corresponding HTTP mapping case.

**Alternatives considered**:
- Plain `throw` (current): the `E` channel stays `never`; all errors are defects (unexpected); no typed mapping possible.
- `Effect.fail(new Error(...))`: works but loses the discriminated union; catch must use `instanceof` checks.
- `Schema.TaggedError` from `@effect/schema`: adds runtime schema validation, useful for errors crossing a serialisation boundary (RPC), overkill for internal domain errors.

---

## 3. Bridging Effect into the Existing Node.js HTTP Server

**Decision**: Use **`ManagedRuntime`** as a module-level singleton created in `main()` after Colyseus starts up. This is the Phase 1 incremental approach. Phase 2 end-state is `NodeRuntime.runMain(Layer.launch(AppLayer))`.

```typescript
// Phase 1 — created once in main(), after gameServer.listen()
const colyseusBridge = createColyseusBridge(room)
const runtime = ManagedRuntime.make(
  Layer.mergeAll(makeWorldBridgeLayer(colyseusBridge), makeRegistryStoreLayer(store))
)

// Per-request call — cheap, schedules a fiber on the shared runtime
if (url.pathname === "/mcp" && req.method === "POST") {
  const result = await runtime.runPromise(
    handleMcpEffect(parsed).pipe(
      Effect.map(v => ({ status: 200, body: JSON.stringify(v) })),
      Effect.catchAll(e => Effect.succeed(errorToResponse(e)))
    )
  )
  res.writeHead(result.status, corsHeaders)
  res.end(result.body)
  return
}
// All other routes stay imperative — no changes needed

// Graceful shutdown
process.on("SIGTERM", async () => { await runtime.dispose(); process.exit(0) })
```

**Rationale**: `ManagedRuntime` is explicitly designed for "environments where Effect is not the primary framework." It memoises all Layer constructions once; `runtime.runPromise` is the per-request call. Module-level `Effect.runPromise` uses the default runtime (empty context) and will not compile for effects that depend on services.

**Alternatives considered**:
- `Effect.runPromise` (module-level): only works for `R = never`; cannot satisfy `WorldBridgeService` in the `R` channel.
- `NodeRuntime.runMain` immediately: requires rewriting `main()` entirely and wrapping Colyseus in a `Layer.scoped`; that is Phase 2 scope.
- Re-creating the runtime per request: valid but slower; Layer resources would be allocated/freed on every request.

---

## 4. Colyseus Coexistence

**Decision**: Phase 1 — leave Colyseus startup imperative; the `ManagedRuntime` is created with the bridge after Colyseus initialises. Phase 2 — wrap `gameServer.listen()` and `matchMaker.createRoom()` in `Layer.scoped` + `Effect.acquireRelease`.

```typescript
// Phase 2 — Colyseus as a managed Layer resource
export const ColyseusLayer = (httpServer: http.Server, port: number, mapPath: string) =>
  Layer.scoped(
    ColyseusServer,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) })
        gameServer.define("matrix", MatrixRoom)
        yield* Effect.promise(() => gameServer.listen(port))
        const listing = yield* Effect.promise(() => matchMaker.createRoom("matrix", { mapPath }))
        return { gameServer, matrixRoomId: listing.roomId }
      }),
      ({ gameServer }) => Effect.promise(() => gameServer.gracefullyShutdown()).pipe(Effect.orElse(() => Effect.void))
    )
  )
```

**Rationale**: `Layer.scoped` + `Effect.acquireRelease` models resources with startup/shutdown contracts. The finaliser runs on all exit paths (success, failure, `Fiber.interrupt`), replacing the scattered `process.on("SIGTERM")` handlers. Phase 1 defers this to avoid risk while still gaining DI and typed errors.

**Alternatives considered**:
- Leave Colyseus outside Effect entirely: viable for Phase 1, accepted trade-off.
- Colyseus `onBeforeShutdown` hook: exists but not composable with Effect's resource model.

---

## 5. Incremental Migration Strategy

**Decision**: Five-wave migration starting at leaf nodes (pure domain logic) and working up to the God File. `Effect.tryPromise` wraps existing `async` functions where a rewrite is deferred.

Migration order:
1. **Wave 1 — leaf nodes** (no HTTP surface): `session-guard.ts`, `jwt.ts`
2. **Wave 2 — auth layer**: `auth-context.ts` (depends on Wave 1)
3. **Wave 3 — registry routes**: `register-house.ts`, `adoption.ts`, `registry/index.ts`
4. **Wave 4 — MCP world-api**: MCP tool handlers, `handleGhostMcpRequest`
5. **Wave 5 — orchestration**: `server/src/index.ts` (all Layers wired, `ManagedRuntime` replaces `let bridge`)

```typescript
// Adapter for existing async functions during migration
const wrappedExistingFn = (args: Args) =>
  Effect.tryPromise({
    try: () => existingAsyncFunction(args),
    catch: (e) => new McpHandlerError({ cause: e })
  })
```

**Rationale**: Starting at leaf nodes means each wave has a stable foundation. At no point does a partially migrated wave break the running server. The `ManagedRuntime` bridge means any single handler can be Effect-native while the rest remain imperative.

**Alternatives considered**:
- Big-bang rewrite: high risk, blocks other feature work.
- Separate Effect worker process: eliminates the in-process Colyseus bridge.

---

## 6. PubSub/Stream for 5,000 Ghost Broadcasts

**Decision**: Use `PubSub.dropping(256)` for the IRL transcript fan-out. One scoped fiber per ghost via `Effect.forkScoped`. Use `Stream.fromPubSub` for composable filtering/batching.

```typescript
// Hub layer — dropping: a slow ghost misses messages rather than stalling all others
export const TranscriptHubLayer = Layer.scoped(
  TranscriptHub,
  Effect.gen(function* () {
    const hub = yield* PubSub.dropping<TranscriptEvent>(256)
    yield* Effect.addFinalizer(() => PubSub.shutdown(hub))
    return hub
  })
)

// Per-ghost subscriber fiber
export const subscribeGhostToHub = (ghostId: string) =>
  Effect.gen(function* () {
    const hub = yield* TranscriptHub
    const dequeue = yield* PubSub.subscribe(hub)
    yield* Effect.forever(
      Queue.take(dequeue).pipe(Effect.flatMap(event => notifyGhost(ghostId, event)))
    )
  })

// Fork on adoption — scoped to ghost session lifetime
yield* Effect.forkScoped(subscribeGhostToHub(ghostId))
```

Fiber cost: 5,000 fibers suspended on `Queue.take` = ~5,000 heap objects (~few MB). Zero CPU. Zero OS threads. The JS event loop is not blocked.

| PubSub type | Publisher blocks? | Slow subscriber | Use when |
|---|---|---|---|
| `bounded(n)` | Yes | Blocks all | All must receive all |
| `dropping(n)` | No | Misses messages | **OK to drop; IRL events ephemeral** |
| `sliding(n)` | No | Gets latest | Freshness over completeness |
| `unbounded` | No | Memory grows | Dev/test only |

**Rationale**: `PubSub.dropping(256)` is the production choice: a ghost that is temporarily slow (LLM inference latency) misses a transcript batch rather than stalling 4,999 others. `Effect.forkScoped` ties each ghost fiber's lifetime to its session scope — automatic cleanup on disconnect, no explicit `Fiber.interrupt` calls.

**Alternatives considered**:
- `Promise.all` / `for...of` over ghost IDs: blocks the event loop for the loop duration.
- EventEmitter broadcast: no backpressure, no supervision, memory leaks.
- RxJS `Subject`: no integration with Effect service/error layer, manual subscription management.
- `bounded(n)`: one slow AI ghost blocks the entire system — wrong tradeoff.

---

## Dependency to Add

Single package: `effect` (v3+). Covers `Context`, `Layer`, `Data`, `PubSub`, `Stream`, `ManagedRuntime`, `Match`, `Queue`, `Fiber`.

Phase 2 only (if adopting Effect's HTTP router): `@effect/platform` + `@effect/platform-node`.

Add to `server/` package only for Phase 1. If world-api or registry packages migrate their internal logic, add there too — but Phase 1 scope keeps Effect confined to the `server/` orchestration package.

---

## Migration Inventory Summary

### Services to define (`Context.Tag`)

| Service | Wraps | Current form |
|---|---|---|
| `WorldBridgeService` | `ColyseusWorldBridge` (4-method interface) | `let bridge: ... \| undefined` in `index.ts` |
| `RegistryStoreService` | `RegistryStore` (Map-based store) | Closure-captured `store` in `index.ts` |
| `GhostAuthorityService` | ghostAuthority Map + read-through logic | Anonymous inline object in `main()` |
| `TranscriptHub` | `PubSub<TranscriptEvent>` | Does not yet exist |
| `ServerConfigService` | httpPort, mapPath, CORS headers | Bare `const` in `main()` scope |

### Error types to replace

| Location | Current | Replacement |
|---|---|---|
| `auth-context.ts` | silent `undefined` return + `throw` | `AuthError` (MissingCredentials, InvalidToken, MalformedClaims) |
| `jwt.ts` | `throw new Error("JWT missing sub")` | `JwtError` (MissingSub, MalformedClaims) |
| `session-guard.ts` | `throw new RegistryConflictError(...)` | `RegistryError` (UnknownCaretaker, UnknownGhostHouse, CaretakerAlreadyHasGhost) |
| `mcp-server.ts` tool handlers | per-tool `try/catch → toolError()` | `WorldApiError` (NoPosition, UnknownCell, MapIntegrity) |
| `index.ts` `spawnGhostOnMap` | `throw new Error("World bridge not ready")` | `WorldBridgeError.NotReady`, `MapError.NoNavigableCells` |

### What to leave alone

- `server/colyseus/src/` — all Colyseus room internals (MatrixRoom, schema, map loader)
- `server/world-api/src/movement.ts` — already pure with discriminated unions; no errors thrown
- `server/world-api/src/colyseus-bridge.ts` — the existing `ColyseusWorldBridge` interface is the correct seam; only wrap it with a `Context.Tag`, do not change the implementation
- `server/src/colyseus-cors-patch.ts` — leave entirely untouched
- `client/` — completely out of scope
- `@aie-matrix/shared-types` — shared DTOs; no migration needed
