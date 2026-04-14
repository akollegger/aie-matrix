# ADR-0002: Adopting Effect-ts for Server Orchestration and Concurrency

**Status:** accepted  
**Date:** 2026-04-14  
**Authors:** @ai-assistant

## Context

The current Colyseus server implementation (`server/src/index.ts`) is a functional PoC that handles HTTP routing, WebSocket orchestration, and world state bridging within a single "God File." As the system scales toward supporting 5,000 concurrent AI ghosts and high-frequency IRL event broadcasts (transcripts), several critical issues have emerged:

1. **Fragile Dependency Management**: Core services (World Bridge, Registry Store) are passed via closures, leading to frequent null/undefined checks and tight coupling.
2. **Opaque Error Handling**: Reliance on `try-catch` blocks and generic 500 HTTP responses makes debugging autonomous ghost interactions difficult.
3. **Concurrency Bottlenecks**: Standard Promise-based loops for broadcasting to thousands of entities are prone to blocking the main thread and lack built-in supervision.
4. **Poor Observability**: Tracing a single request from the World-API through the Bridge into the Colyseus room requires scattered debug statements.

## Decision

We will transition the server back-end orchestration layer to **Effect-ts**. This involves a phased migration:

1. **Service Layer (Phase 1)**: Replace closures with `Context.Tag` and `Layer` for dependency injection of core services (`WorldBridge`, `RegistryStore`).
2. **Typed Errors (Phase 1)**: Move from `throw` to typed error channels, ensuring all domain failures are explicitly handled and mapped to correct HTTP responses.
3. **Structured Concurrency (Phase 2)**: Use `Effect.Stream` and `Effect.PubSub` for handling the IRL transcript feed and ghost broadcasts.
4. **Observability (Phase 2)**: Leverage Effect's built-in tracing and structured logging to implement request-scoped IDs across the bridge.

Phases may overlap. Handlers migrated in Phase 1 can coexist with legacy closures during the transition.

## Rationale

Effect-ts provides a unified toolkit for the exact problems we are facing:
- **Dependency Injection**: The Layer system provides a type-safe way to manage dependencies, making the code more modular and testable.
- **Error Management**: Typed errors eliminate the "catch-all" 500 error and force developers to consider failure modes.
- **Scalable Concurrency**: Effect's fiber-based concurrency and streams are designed for high-throughput, non-blocking IO, which is essential for the 5,000-ghost target.
- **Supervision**: The ability to define supervision strategies for background streams (like the transcript listener) ensures the server is self-healing.

This ADR also resolves the "Observability and Telemetry" open question in `docs/architecture.md` by requiring structured logging and request tracing as first-class abstractions. Effect's built-in tracing capabilities make this requirement enforceable at the framework level rather than as a convention.

## Alternatives Considered

- **Standard Class-based Refactor**: Moving to a more traditional OOP structure with dependency injection containers. 
  - *Why rejected*: While this solves the dependency problem, it doesn't address the underlying concurrency and error-handling fragility inherent in JS Promises.
- **Moving to a heavier Framework (e.g., NestJS)**: 
  - *Why rejected*: NestJS provides DI and structure but adds significant boilerplate and doesn't provide the advanced concurrency primitives (fibers/streams) needed for this specific real-time scale.
- **RxJS for Broadcasting**: 
  - *Why rejected*: RxJS is powerful for streams but doesn't provide the holistic environment (DI, Error handling, Lifecycle management) that Effect provides as a full ecosystem.

## Consequences

### Positives
- **Increased Reliability**: Supervision and typed errors reduce runtime crashes and "silent" failures.
- **Better Developer Experience**: Request tracing makes debugging ghost behavior significantly faster.
- **Proven Scalability**: Structured concurrency allows us to handle thousands of entities without blocking the event loop.

### Negatives/Risks
- **Learning Curve**: Effect-ts has a steep learning curve for developers unfamiliar with functional programming patterns. *Mitigation*: Early work should be done in pairing sessions with Effect-experienced contributors. A shared internal guide for common patterns (service definition, error handling, stream orchestration) should be created during Phase 1.
- **Initial Velocity Drop**: The transition period will require more design time per feature than the previous imperative approach.
- **Type Complexity**: TypeScript types can become complex when dealing with deeply nested Effect requirements.
- **Vendor Lock-In**: Once the Effect-ts orchestration layer is in place, reversing the decision would require rewriting all handlers and service layers — a costly operation that locks in the framework choice for the server's lifetime.

### Architecture Impact
- `docs/architecture.md` must be updated to add the orchestration layer framework to the Decided Stack and to document the Layer/Context service pattern as a binding contract for new handlers.
