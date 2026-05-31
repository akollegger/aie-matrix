# Research: In-World Resource Ledger

## Double-Entry Ledger Pattern in Effect-ts

**Decision**: Model the ledger as an append-only `(:LedgerEntry)` chain in Neo4j, with in-memory bag caches materialized on startup by replaying the chain.

**Rationale**: The existing `LiveSessionService` and `MapService` already own session lifecycle in `server/world-api`. The ledger is another session-scoped service following the same `Context.Tag` / `Layer.succeed` pattern. Neo4j is the decided world graph store; `(:LedgerEntry)` nodes fit naturally into the session subgraph already used by `:CalendarEvent` nodes (RFC-0021 / spec-021).

**Alternatives considered**: JSONL-to-S3 (simpler append but no graph queries); Redis stream (fast but ephemeral without extra persistence); mutable Neo4j relationships only (no event log, no tamper-evidence). All rejected per RFC-0023 §10 and architecture.md.

---

## Hash-Chaining Approach

**Decision**: SHA-256 over a canonical JSON serialization of `{ id, movements, cause, actors, ts, prevHash }`. The genesis entry's `prevHash` is the empty string `""`.

**Rationale**: SHA-256 is available in Node.js `node:crypto` without additional dependencies. Canonical JSON (sorted keys) ensures deterministic hashing regardless of property insertion order. This is sufficient for tamper-evidence at AIEWF scale; a merkle layer is a noted future extension (RFC-0023 §2) and the transaction shape accommodates it without change.

**Alternatives considered**: BLAKE3 (faster, no native support in Node 24 without a native addon — adds a dep); per-entry HMAC with a server secret (tamper-evident but not independently verifiable). Rejected; SHA-256 is zero-dep and independently verifiable.

---

## Single-Writer Constraint

**Decision**: The `LedgerService` is instantiated once per world-api process. A session has exactly one world-api owner (enforced by `LiveSessionService`'s session mutex). No distributed locking is needed for MVP.

**Rationale**: The existing `LiveSessionService` already enforces one active session per process. The world-api is not horizontally scaled per-session at AIEWF scale. This matches RFC-0023 §2's "single writer" requirement without new infrastructure.

**Alternatives considered**: Redis-based distributed lock (needed only if world-api scales horizontally per session — deferred per RFC-0023 §10). Not needed for MVP.

---

## Bag Materialization Strategy

**Decision**: On `LedgerService` startup (within the session's layer provision), replay all `(:LedgerEntry)` nodes for the session from genesis and fold movements into an in-memory `Map<actorId, Map<resource, number>>`. All reads are served from memory; writes append to Neo4j then update the in-memory cache atomically within the single writer.

**Rationale**: Keeps read latency at O(1) (memory lookup). Write path: validate → append to Neo4j → update cache — still synchronous within the single-writer Effect fiber. Matches the CQRS read-model pattern described in RFC-0023 §2.

**Alternatives considered**: Query Neo4j on every balance read (simpler, but adds Neo4j round-trip to every `inventory` call and every cost-check on `GO`). Rejected for latency.

---

## Cost Enforcement Integration Point

**Decision**: Cost enforcement lives in `server/world-api/src/movement.ts` (the `go` action handler). Before committing the movement, `movement.ts` calls `LedgerService.quote(actorId, costs[])` which returns either the quoted cost or `InsufficientFunds`. On ghost acceptance, it calls `LedgerService.commit(transaction)`.

**Rationale**: `movement.ts` already owns the `GO` rule check against the Neo4j ruleset graph. Adding a cost check there keeps all `GO` authorization in one place. The ledger itself stays policy-free — it just validates conservation and appends.

---

## Resource Seed Declaration

**Decision**: For MVP, resource types and world bag seed are declared as a top-level `[resources:Resources | ...]` layer block in the map's `.map.gram` file, parsed by `@aie-matrix/map-gram`. The `LedgerService` reads this on session start and appends the genesis transaction.

**Rationale**: Fits the existing `.map.gram` layer syntax. Consistent with how items and rules are declared. Auditable in source control. An admin API for runtime registration is explicitly deferred (RFC-0023 open question 1).

---

## Test Strategy

**Decision**: Two tiers per the constitution:
- **Unit tests** (`server/world-api/test/`): `LedgerService` with an in-memory implementation (no Neo4j). Covers all interface methods, conservation invariant, `InsufficientFunds` denial, duplicate ULID rejection, monotonic-only-accumulate, and chain verification.
- **Integration tests**: Same interface, Neo4j-backed implementation. Skipped when `NEO4J_URI` is unset. Covers persistence across restart (replay-from-genesis).

**Rationale**: Constitution requires unit tests in the same change. Integration tests may land separately if Neo4j is unavailable in CI — documented in the plan per the constitution's integration test expectations.
