---
name: aie-matrix-effect
description: Effect-ts coding standard for all server-side packages in aie-matrix (ghosts/ghost-house/ and server/*). Use when writing or reviewing services, route handlers, error types, logging, configuration, or background fibers in any of these packages.
---

# Effect-ts Standard — aie-matrix server packages

Applies to: `ghosts/ghost-house/`, `server/world-api/`, `server/registry/`, `server/conversation/`, `server/src/`.

The authoritative narrative is `docs/guides/effect-ts.md`. This skill adds the concrete decisions and canonical file references needed to write new code consistently.

---

## 1. Service interfaces return `Effect<T, E>`, never `Promise<T>`

Every method on a service interface must return `Effect.Effect<A, E>` with typed errors.

```typescript
export interface IMyService {
  readonly doThing: (id: string) => Effect.Effect<Result, NotFoundError | ValidationError>;
  readonly bestEffort: () => Effect.Effect<void>;  // never fails — errors become defects
}
```

**Canonical examples:**
- `ghosts/ghost-house/src/catalog/CatalogService.ts` — `get`, `register`, `deregister`
- `ghosts/ghost-house/src/a2a-host/A2AHostService.ts` — `pingAgent`, `sendSpawnContext`
- `server/conversation/src/ConversationService.ts` — `ConversationServiceShape`

---

## 2. Service definition: `Context.Tag` + unique string identifier

```typescript
export class MyService extends Context.Tag("ghost-house/MyService")<
  MyService,
  IMyService
>() {}
```

String prefix must be `"<package>/ServiceName"` — unique across the whole workspace.

| Scenario | Layer constructor |
|---|---|
| Sync / pre-built value | `Layer.succeed(MyService, impl)` |
| Needs dependencies | `Layer.effect(MyService, Effect.gen(function* () { ... }))` |
| Needs async setup or cleanup | `Layer.scoped(MyService, Effect.acquireRelease(acquire, release))` |

---

## 3. Typed errors: `Data.TaggedError` + exhaustive switch at boundaries

```typescript
export class AgentNotFound extends Data.TaggedError("AgentNotFound")<{ agentId: string }> {}
export class SpawnFailed   extends Data.TaggedError("SpawnFailed")<{ message: string }> {}
export type HouseError = AgentNotFound | SpawnFailed | /* ... */;
```

**Use `Effect.fail`, never `throw`:**
```typescript
// ✓
return yield* Effect.fail(new AgentNotFound({ agentId }));

// ✗  — converts typed error into an untyped defect
throw new AgentNotFound({ agentId });
```

**HTTP boundary — `switch(_tag)` + `assertNever`, not instanceof chains:**
```typescript
function toHttpResponse(e: HouseError): { status: number; body: unknown } {
  switch (e._tag) {
    case "AgentNotFound": return { status: 404, body: { code: "NOT_FOUND", agentId: e.agentId } };
    case "SpawnFailed":   return { status: 503, body: { code: "AGENT_UNREACHABLE", message: e.message } };
    default: assertNever(e);  // compile error when a new variant is added without a case
  }
}
```

**Canonical examples:**
- `server/src/errors.ts` — `errorToResponse` with `assertNever` (the target pattern)
- `ghosts/ghost-house/src/http-error-map.ts` — instanceof chain (known migration target)

---

## 4. ManagedRuntime: one per process, all handlers run through it

```typescript
// Created once at startup — errors if any required Layer is missing:
const runtime = ManagedRuntime.make(appLayer);

// Route handler:
app.get("/v1/thing/:id", (req, res) => {
  void runtime.runPromise(
    Effect.gen(function* () {
      const svc = yield* MyService;
      const result = yield* svc.doThing(req.params.id!);
      res.status(200).json(result);
    }).pipe(
      Effect.catchAll((e) =>
        Effect.sync(() => {
          const { status, body } = toHttpResponse(e);
          res.status(status).json(body);
        }),
      ),
    ),
  );
});

// Graceful shutdown — runs all Layer release functions:
process.on("SIGTERM", () => void runtime.dispose().finally(() => process.exit(0)));
```

**Never call `Effect.runPromise` or `Effect.runSync` inside a service method.** Run only at the process boundary via `runtime.runPromise` or `runtime.runFork`.

**Canonical examples:**
- `ghosts/ghost-house/src/main.ts` — `ManagedRuntime.make(appLayer)` + route handlers
- `server/src/index.ts` — combined server runtime

---

## 5. Logging: `Effect.logInfo` / `Effect.annotateLogs`

Use Effect's built-in logging instead of `console.*` calls. The fiber ID is automatically included in every log entry — no manual trace ID threading needed inside Effect code.

**Standard pattern:**
```typescript
yield* Effect.logInfo("session.spawn").pipe(
  Effect.annotateLogs({ sessionId, agentId, ghostId }),
);

yield* Effect.logError("session.spawn.failed").pipe(
  Effect.annotateLogs({ sessionId, agentId, message: e.message }),
);

yield* Effect.logDebug("health.tick").pipe(
  Effect.annotateLogs({ sessionId, status: s.status }),
);
```

**Log levels:**

| Function | When to use |
|---|---|
| `Effect.logDebug` | Diagnostic detail, off by default in production |
| `Effect.logInfo` | Normal operational events (spawns, shutdowns, registrations) |
| `Effect.logWarning` | Degraded-but-recoverable situations (rate-limit drops, retries) |
| `Effect.logError` | Failures that affect a session or request |
| `Effect.logFatal` | Process-level failures before exit |

**Never use `console.*` in Effect code** — it bypasses log level filtering and loses fiber context.

**Logger setup in the root Layer:**
```typescript
// In appLayer / ManagedRuntime setup:
const appLayer = Layer.mergeAll(
  /* services ... */,
  Logger.replace(Logger.defaultLogger, Logger.json),        // production
  // or:
  Logger.replace(Logger.defaultLogger, Logger.pretty),      // local dev
);
```

`Logger.json` emits one JSON object per line containing `message`, `logLevel`, `timestamp`, `fiberId`, and all annotations — suitable for log aggregation (Datadog, CloudWatch, etc.).

**Bridging non-Effect callbacks** (e.g. Colyseus event handlers, SDK callbacks):
```typescript
// When you must log from outside an Effect pipeline, use the runtime:
runtime.runFork(
  Effect.logInfo("world-bridge.event").pipe(
    Effect.annotateLogs({ kind: ev.kind, ghostId: ev.ghostId }),
  ),
);
```

**Canonical examples (migration targets — not yet using Effect logging):**
- `ghosts/ghost-house/src/supervisor/SupervisorService.ts` — `slog` helper
- `server/src/index.ts` — `console.info(JSON.stringify({kind: ...}))`
- `server/world-api/src/mcp-server.ts` — `logJson` helper

---

## 6. Background fibers: `Effect.forkDaemon` inside Effects

For long-lived background tasks started from within a service method:

```typescript
// Inside Effect.gen — daemon fiber runs independently of parent scope:
const fiber = yield* Effect.forkDaemon(myBackgroundLoop);
fiberMap.set(id, fiber);

// To stop it later (e.g. in a shutdown Effect):
yield* Fiber.interrupt(fiber);
```

Do not call `Effect.runFork` inside an `Effect.gen` block — use `Effect.forkDaemon` instead. `Effect.runFork` is only for bootstrapping at the process entry point.

**Canonical example:**
- `ghosts/ghost-house/src/supervisor/SupervisorService.ts` — `startHealth` / `Effect.forkDaemon`

---

## 7. Configuration: parse env at startup, inject via Layer

Do not read `process.env` inside service implementations. Parse all configuration in a dedicated function and provide it via a Layer:

```typescript
type AppConfig = { readonly port: number; readonly catalogPath: string; /* ... */ };

function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    port: parseInt(env.PORT ?? "4000", 10),
    catalogPath: env.CATALOG_FILE_PATH ?? "./catalog.json",
  };
}

export class AppConfig extends Context.Tag("ghost-house/AppConfig")<AppConfig, AppConfig>() {}
export const AppConfigLayer = Layer.sync(AppConfig, () => parseConfig(process.env));
```

Services read config with `yield* AppConfig`.

**Canonical example:**
- `server/src/services/ServerConfigService.ts` — `parseServerConfigFromEnv` + `Layer.succeed`

Ghost-house currently reads `process.env` inline in several places — new code should use the Layer pattern.

---

## Anti-pattern quick-reference

| Anti-pattern | Correct form |
|---|---|
| Service method returns `Promise<T>` | Return `Effect.Effect<T, E>` |
| `throw new MyError(...)` | `yield* Effect.fail(new MyError(...))` |
| `instanceof` chain at HTTP boundary | `switch(e._tag)` + `assertNever` |
| `Effect.runPromise` inside a service | `yield*` the Effect; run only at the boundary |
| `Effect.runFork` inside `Effect.gen` | `Effect.forkDaemon` |
| `console.info(JSON.stringify({...}))` | `yield* Effect.logInfo("...").pipe(Effect.annotateLogs({...}))` |
| `process.env.X` read inside a service | `yield* AppConfig` (inject via Layer) |
| Module-level mutable singleton | `Layer.sync` / `Layer.succeed` |

---

## Known gaps (as of branch 009-ghost-house-a2a)

Do not replicate these in new code — they are tracked migration targets:

- `ghosts/ghost-house/src/http-error-map.ts` — instanceof chain → `switch(_tag)` + `assertNever`
- `ghosts/ghost-house/src/supervisor/SupervisorService.ts` `slog` — `console.error` → `Effect.logWarning` / `Effect.logError`
- `server/src/index.ts`, `server/world-api/src/mcp-server.ts` — `console.info(JSON.stringify(...))` → `Effect.logInfo` + `annotateLogs`
- `ghosts/ghost-house/src/main.ts` — inline `process.env` reads → `AppConfigLayer`
- `server/*` — no `Logger.replace` in root Layer (logs go through default pretty-printer instead of `Logger.json`)
