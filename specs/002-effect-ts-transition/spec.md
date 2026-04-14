# Feature Specification: Effect-ts Transition for Server Scalability

**Feature Branch**: `002-effect-ts-transition`  
**Created**: 2026-04-14  
**Status**: Draft  
**Input**: User description: "Transition to effect-ts for robust services as the system scales. Incorporate key points from this conversation into the spec"

## Proposal Context

- **Related Proposal**: N/A (Architectural shift from PoC to Scalable Production)
- **Scope Boundary**: 
  - Refactoring the server orchestration (`server/src/index.ts`) into a service-based architecture.
  - Implementing typed error handling for the World-API and Registry endpoints.
  - Establishing a structured concurrency model for high-volume broadcasts (e.g., IRL event transcripts).
  - Introducing system-wide observability and tracing for AI ghost interactions.
- **Out of Scope**: 
  - Rewriting the Colyseus core library or existing `MatrixRoom` logic.
  - Changes to the Phaser client-side implementation.
  - Migrating the `registry` or `world-api` packages to Effect until the main server orchestration is stable.

## User Scenarios & Testing

### User Story 1 - Service-Based Dependency Management (Priority: P1)

The developer can define and inject core system components (like the World Bridge and Registry Store) without relying on global variables or deeply nested closures.

**Why this priority**: This is the foundation of the transition. It eliminates "undefined" state checks and makes the system testable.

**Independent Test**: Can be fully tested by verifying that the `WorldBridge` can be provided to an MCP handler without the handler needing to know how the bridge was instantiated.

**Acceptance Scenarios**:

1. **Given** a request to the World-API, **When** the handler requires the `WorldBridge` service, **Then** the system provides the implementation from the environment without manual null checks.
2. **Given** a test environment, **When** a mock `WorldBridge` is provided, **Then** the handlers operate correctly using the mock.

---

### User Story 2 - Predictable Error Handling (Priority: P1)

When an AI ghost makes a request that fails (e.g., attempting to move to a non-existent cell), the system returns a typed, meaningful error that can be mapped to a specific HTTP response.

**Why this priority**: Removes the reliance on `try-catch` blocks and generic 500 errors, which are currently a major pain point for debugging.

**Independent Test**: Can be fully tested by triggering a "Not Found" error in the World-API and verifying the response is a 404 with a specific error code rather than a generic 500.

**Acceptance Scenarios**:

1. **Given** an invalid request, **When** the domain logic fails, **Then** the error is captured in a typed channel and mapped to the correct HTTP status code.
2. **Given** an unexpected system failure, **When** the error is unhandled, **Then** it is caught by a global supervisor and logged with full trace context.

---

### User Story 3 - Scalable Event Broadcasting (Priority: P2)

The system can ingest a high-volume stream of IRL event transcripts and broadcast them to 5,000 concurrent ghosts without blocking the main server thread or causing lag in ghost movement.

**Why this priority**: This is a core requirement for the IRL event use case. Standard promise-based loops will not scale to 5,000 concurrent updates.

**Independent Test**: Can be tested by simulating 5,000 active ghost connections and streaming 10 transcripts per second, verifying that movement latency remains under 100ms.

**Acceptance Scenarios**:

1. **Given** a stream of incoming transcripts, **When** a new transcript arrives, **Then** it is broadcast to all relevant ghosts using a non-blocking concurrency model.
2. **Given** a failure in the transcript ingestion stream, **When** the stream crashes, **Then** the system automatically restarts the listener without affecting the rest of the server.

---

### User Story 4 - System-Wide Observability (Priority: P2)

The developer can trace the lifecycle of a single AI ghost's request from the HTTP entry point, through the World Bridge, and into the Colyseus state change.

**Why this priority**: Essential for debugging a distributed-like system where ghosts are acting autonomously.

**Independent Test**: Can be tested by searching for a unique Request ID in the logs and seeing every step of the execution path across different services.

**Acceptance Scenarios**:

1. **Given** an incoming MCP request, **When** it is processed, **Then** all associated logs are tagged with a unique trace ID.
2. **Given** a failure in the system, **When** reviewing logs, **Then** the developer can see the exact sequence of events leading to the failure.

### Edge Cases

- What happens when the IRL transcript stream provides data faster than the Colyseus room can broadcast? (Backpressure handling)
- How does the system handle a "thundering herd" of 5,000 ghosts all attempting to react to the same broadcast simultaneously?
- What happens if the `WorldBridge` service fails to initialize but the HTTP server is already listening?

## Requirements

### Functional Requirements

- **FR-001**: The system MUST use a Service/Layer pattern for all core dependencies to eliminate manual dependency passing.
- **FR-002**: The system MUST implement typed error channels for all domain logic, replacing `throw` with explicit error types.
- **FR-003**: The system MUST use structured concurrency (fibers/streams) to handle IRL event broadcasts to support up to 5,000 concurrent entities.
- **FR-004**: The system MUST provide request tracing and structured logging for all AI ghost interactions.
- **FR-005**: The server MUST implement a supervised lifecycle management system that ensures graceful startup and shutdown of all services.
- **FR-006**: The system MUST implement backpressure management for the IRL transcript stream to prevent memory exhaustion during high-volume events.

### Key Entities

- **WorldBridge Service**: The coordinator that bridges the gap between the stateless World-API and the stateful Colyseus Room.
- **RegistryStore Service**: The authority on ghost identities, adoptions, and initial spawn locations.
- **Transcript Stream**: A high-throughput data flow representing real-time event transcripts.
- **Execution Trace**: A unique identifier and metadata set attached to a request's lifecycle.

### Interface Contracts

- **IC-001**: A mapping contract must be defined that translates internal typed errors (e.g., `GhostNotFoundError`) to standard HTTP response codes (e.g., `404 Not Found`).
- **IC-002**: The broadcast interface must support a "publish-subscribe" pattern to decouple transcript ingestion from the Colyseus broadcast.

## Success Criteria

### Measurable Outcomes

- **SC-001**: The system supports 5,000 concurrent ghosts receiving broadcasts without increasing the API response latency for movement above 200ms.
- **SC-002**: Mean Time to Recovery (MTTR) for the broadcast stream is under 1 second via automatic supervision.
- **SC-003**: 100% of API requests are traceable via a unique ID from entry to state change.
- **SC-004**: Elimination of all `if (!service) throw new Error(...)` patterns in the server logic.

## Assumptions

- The IRL transcript source is provided as a streamable interface (e.g., WebSocket or Server-Sent Events).
- The authoritative state of the world remains within the Colyseus room; Effect-ts is used for the orchestration and delivery layer.
- Memory available on the server is sufficient to handle 5,000 lightweight fibers.

## Documentation Impact

- **docs/architecture.md**: MUST be updated to describe the Effect-ts service architecture and the new concurrency model.
- **README.md**: Update server start-up and development instructions to reflect the new structure.
- **CONTRIBUTING.md**: Add guidelines for writing new services and handlers using the Effect pattern.
