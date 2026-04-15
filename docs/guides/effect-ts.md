# Effect-ts in aie-matrix

**Why Effect-ts:** The server uses Effect-ts (v3+) for dependency injection, typed errors, structured concurrency, and request tracing. See [ADR-0002](../../proposals/adr/0002-adopt-effect-ts.md) for the decision and rationale.

This guide documents the patterns established in this codebase. It is not a general Effect tutorial — consult [effect.website](https://effect.website) for that.

---

## Core Patterns

### 1. Service definition

Every injectable dependency is a `Context.Tag` class wrapping an interface. The tag string is the DI key and must be unique project-wide.

```typescript
// Wraps an existing interface (zero new abstractions needed)
export class WorldBridgeService extends Context.Tag("aie-matrix/WorldBridgeService")<
  WorldBridgeService,
  ColyseusWorldBridge   // ← the interface Effect code receives via yield*
>() {}

// Layer.succeed for synchronous / already-constructed implementations
export const makeWorldBridgeLayer = (bridge: ColyseusWorldBridge): Layer.Layer<WorldBridgeService> =>
  Layer.succeed(WorldBridgeService, bridge);
```

Use `Layer.scoped` when the service needs async setup or a cleanup finalizer:

```typescript
export const TranscriptHubLayer = Layer.scoped(
  TranscriptHub,
  Effect.gen(function* () {
    const hub = yield* PubSub.dropping<TranscriptEvent>(256);
    yield* Effect.addFinalizer(() => PubSub.shutdown(hub));  // runs on runtime.dispose()
    return hub;
  }),
);
```

**Where to find examples:**
- `server/world-api/src/WorldBridgeService.ts` — minimal `Layer.succeed` pattern
- `server/world-api/src/RegistryStoreService.ts` — same pattern, different interface
- `server/src/services/TranscriptHubService.ts` — `Layer.scoped` with finalizer
- `server/src/services/ServerConfigService.ts` — Layer built from `process.env`

---

### 2. Typed errors

Domain failures use `Data.TaggedError`. The tag string is the discriminant used by `Match.tag` in `errorToResponse`.

```typescript
// Convention: "Domain.Variant" groups errors by domain
export class WorldApiNoPosition extends Data.TaggedError("WorldApiError.NoPosition")<{
  readonly ghostId: string;
}> {}

export class WorldApiUnknownCell extends Data.TaggedError("WorldApiError.UnknownCell")<{
  readonly cellId: string;
}> {}

// Export a union type for handler signatures
export type WorldApiError = WorldApiNoPosition | WorldApiUnknownCell | WorldApiMapIntegrity | WorldApiMovementBlocked;
```

**Where to find examples:**
- `server/world-api/src/world-api-errors.ts` — WorldApiError family
- `server/auth/src/jwt-errors.ts` — JwtError family
- `server/world-api/src/auth-errors.ts` — AuthError family
- `server/registry/src/registry-errors.ts` — RegistryError family

---

### 3. Effect pipelines

Handlers use `Effect.gen` with `yield*` to access services and propagate typed errors. The type signature makes the requirements explicit.

```typescript
export function handleAdoptGhostEffect(
  req: IncomingMessage,
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  deps: AdoptionRuntimeDeps,
): Effect.Effect<
  void,
  RegistryBadJson | RegistryHttpError | WorldBridgeNoNavigableCells,  // ← E channel
  RegistryStoreService | WorldBridgeService                           // ← R channel (requirements)
> {
  return Effect.gen(function* () {
    const store = yield* RegistryStoreService;   // inject service
    const bridge = yield* WorldBridgeService;
    yield* assertAdoptionAllowed(store, ...);    // typed error propagates up E channel
    // ...
  });
}
```

**Where to find examples:**
- `server/registry/src/routes/adoption.ts` — full handler with two service dependencies
- `server/registry/src/routes/register-house.ts` — single-service handler
- `server/registry/src/index.ts` — route recovery wrapper pattern

---

### 4. ManagedRuntime composition

All service Layers are merged into a single `ManagedRuntime` at startup. TypeScript will fail to compile if any Layer is missing for an Effect that requires it (the `R` channel must reduce to `never`).

```typescript
// server/src/index.ts
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    makeWorldBridgeLayer(bridge),
    makeRegistryStoreLayer(store),
    makeServerConfigLayer(process.env),
    TranscriptHubLayer,
  ),
);

// Running an Effect from outside Effect land:
await runtime.runPromise(myEffect);

// Fire-and-forget background fiber:
runtime.runFork(backgroundEffect);

// Graceful shutdown — runs all Layer finalizers:
process.on("SIGTERM", () => {
  void runtime.dispose().finally(() => process.exit(0));
});
```

**Where to find examples:**
- `server/src/index.ts` — the combined server's ManagedRuntime wiring

---

### 5. Exhaustive error mapping to HTTP

The `errorToResponse` function in `server/src/errors.ts` maps all domain errors to `{ status, body }` using `Match.exhaustive`. This is a compile-time guarantee: adding a new error type without updating this function will fail the build.

```typescript
export function errorToResponse(error: HttpMappingError): { status: number; body: string } {
  return pipe(
    Match.type<HttpMappingError>(),
    Match.tag("AuthError.MissingCredentials", "AuthError.InvalidToken", ..., (e) => ({
      status: 401,
      body: JSON.stringify({ error: "AUTH_ERROR", ... }),
    })),
    Match.tag("WorldApiError.NoPosition", (e) => ({
      status: 404,
      body: JSON.stringify({ error: "NO_POSITION", ghostId: e.ghostId }),
    })),
    // ... all variants ...
    Match.exhaustive,   // ← compiler error if a variant is missing
  )(error);
}
```

When you add a new error class, the steps are:
1. Define it with `Data.TaggedError` in the appropriate `*-errors.ts` file
2. Add it to the domain union type
3. Add a `Match.tag` branch in `errorToResponse` (compile will fail until you do)

**Where to find examples:**
- `server/src/errors.ts` — the full mapping with all current error types

---

### 6. Request tracing

Each `/mcp` and `/registry/adopt` request is assigned a UUID trace ID. The tracing uses two complementary mechanisms:

- **`AsyncLocalStorage`** — propagates through `await` chains in Node.js (used by MCP SDK callbacks that run outside Effect's fiber scheduler)
- **`FiberRef`** — scoped to the Effect fiber tree

```typescript
// Entry point (server/src/index.ts — /mcp route):
const traceId = randomUUID();
await runWithRequestTrace(traceId, () =>        // AsyncLocalStorage context
  runtime.runPromise(
    withRequestTraceFiber(                      // FiberRef context
      traceId,
      handleGhostMcpEffect(req, res, parsed).pipe(
        Effect.catchAll((e) => Effect.sync(() => {
          const { status, body } = errorToResponse(e as HttpMappingError);
          res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders });
          res.end(body);
        })),
      ),
    ),
  ),
);

// Reading the trace ID from inside a handler or bridge:
const traceId = getRequestTraceId();   // returns string | undefined
```

Structured log lines use this pattern:
```typescript
console.info(JSON.stringify({
  kind: "mcp.tool",     // identifies the log category
  op: "go",             // specific operation
  traceId,              // correlates all lines for one request
  ghostId,
  phase: "start",
}));
```

**Where to find examples:**
- `server/world-api/src/request-trace.ts` — the dual ALS+FiberRef implementation
- `server/src/index.ts` — entry point wiring for `/mcp`
- `server/world-api/src/mcp-server.ts` — `logMcpBridgeOp` helper, tool-level logging

---

## Anti-patterns

**Don't add an error type without updating `errorToResponse`.**
`Match.exhaustive` turns this into a compile error, but only if the error type is added to the `HttpMappingError` union in `server/src/errors.ts`. If you define a new error but don't add it to the union, you'll get a silent gap at runtime.

**Don't consume a service outside `Effect.gen`.**
Services are only available inside an Effect pipeline. If you need a service value in imperative code, thread it through an Effect from the handler boundary.

**Don't add a new service without wiring its Layer into `ManagedRuntime.make()`.**
TypeScript will flag this as an unsatisfied `R` channel during `pnpm typecheck`, but only if the effect is actually run through the runtime. Adding a Layer in `Layer.mergeAll` is the fix.

**Don't use `Effect.runPromise` directly in application code.**
All Effect execution in the server goes through `runtime.runPromise` or `runtime.runFork`. This ensures services are available and the runtime lifecycle is respected.

---

## Adding a new service

1. Create `server/src/services/MyService.ts` (or in the relevant package under `src/`):
   - Define the interface
   - Define `class MyService extends Context.Tag("aie-matrix/MyService")<MyService, MyInterface>()`
   - Export a `makeMyLayer(...)` function returning `Layer.Layer<MyService>`

2. Add the layer to `ManagedRuntime.make(Layer.mergeAll(..., makeMyLayer(...)))` in `server/src/index.ts`.

3. Run `pnpm typecheck` — an unsatisfied `R` channel will surface immediately.

---

## Adding a new route handler

1. Write the handler as `Effect.Effect<void, SomeError, SomeService | OtherService>`.
2. Wrap it in `withRegistryRouteRecovery` (registry) or the equivalent error-catch pattern (MCP).
3. Run it via `runtime.runPromise(...)`.
4. Make sure all errors the handler can yield are covered in `errorToResponse`.
