# Research: Group Formation and Group Chat

## Group Actor as a World Graph Node

**Decision**: Represent `(:Group)` as a new Neo4j node label alongside `:Ghost`, `:Item`, and `:Bag`. No new top-level directory; new files live inside the existing `server/world-api` package.

**Rationale**: `(:Group)` is structurally identical to other disembodied actors already in the world graph (`:Bag`, `:LedgerEntry`). Adding it as a node label preserves the established graph schema extension pattern used by RFC-0021 and RFC-0023. No new storage system is needed.

**Alternatives considered**: A separate `server/group` sub-package (matches the `server/conversation` pattern). Rejected — group state is tightly coupled to `LedgerService` and the Neo4j session subgraph; a new package adds a dependency chain without isolation benefit. Single package is the simpler choice per CLAUDE.md principle of preferring the smallest change.

---

## Shared Formation Offer: `shared` Flag Extension to ProposalService

**Decision**: Extend the existing `ProposalService` (introduced in spec-022) with a `shared: true` flag on `ProposeParams`. When `shared` is set, the service routes both sides of the exchange to a newly minted group bag rather than to each other's individual bags. The `agree` path creates the `(:Group)` node, `MEMBER_OF` edges, and group chat thread atomically.

**Rationale**: `ProposalService` already owns the offer/accept handshake for ghost-to-ghost trades and calls `LedgerService.commit` with a multi-actor `actors[]` field. The `shared` extension is a transaction variant, not a new mechanic — it changes the destination bag, not the protocol. RFC-0024 explicitly specifies this approach and calls for a ledger service addendum (IC-001 in the spec).

**Alternatives considered**: A separate `GroupProposalService`. Rejected — ProposalService already models the exact lifecycle (propose → agree/decline/expire) and holds the proximity checks. A second service would duplicate the state machine; extending the existing service is the minimal change.

---

## Admission Vote: In-Memory Vote Window

**Decision**: Implement the admission vote as an in-memory structure in `GroupService` (similar to how `ProposalService` holds pending proposals in memory). Votes are not persisted. The outcome — admitted or rejected — is recorded in the world graph (MEMBER_OF edge created or offer cancelled) and durably committed to the ledger.

**Rationale**: The vote window is ephemeral by design (expires at offer expiry). Only the final outcome is durable. This matches the exact pattern used by `ProposalService` for trade proposals. If the server restarts mid-vote, the offer simply expires — the same behavior as a timed-out trade proposal.

**Alternatives considered**: Neo4j-persisted vote records. Rejected — adds graph complexity for data that is intentionally short-lived. Persisting votes would create orphan nodes on server restart. The existing ProposalService pattern handles this correctly without persistence.

---

## Group Chat Fan-Out: Extend ConversationService

**Decision**: Add a `groupSay` method to `ConversationService` (or introduce a thin `GroupChatService` that delegates to the existing `JsonlStore` and signals the Colyseus bridge). Fan-out targets are the member set + participant set fetched from Neo4j at send time, rather than the H3 spatial cluster used by ghost `say`.

**Rationale**: RFC-0024 explicitly specifies reuse of the conversation store and Colyseus `message.new` signal infrastructure (RFC-0005). The only difference is the fan-out target: membership set instead of spatial cluster. Adding a `groupSay` method keeps the JSONL store and signal format consistent while swapping the target-resolution logic.

**Alternatives considered**: A separate `GroupChatService` with its own JSONL store. Acceptable — and cleaner for isolation — but adds a new package or a confusing co-located service. A method on `ConversationService` is the minimal extension that reuses the existing `JsonlStore` and signal infrastructure.

**Preferred**: Thin `GroupChatService` in `server/world-api` that wraps `JsonlStore` and calls `WorldBridgeService` for signal fan-out. Keeps `ConversationService` unchanged and keeps ownership explicit.

---

## `unique-names-generator` for Group Naming

**Decision**: Add `unique-names-generator` as a dependency of `server/world-api` (or the package that mints groups). The server assigns a name at group creation; no user input required.

**Rationale**: `unique-names-generator` is already a monorepo dependency (tools/map-editor). Adding it to `server/world-api` is a minor dep addition. RFC-0024 explicitly resolves the group naming question this way.

**Alternatives considered**: ULIDs as display names (ugly), numeric group IDs (unreadable), random word pairs from a custom list (reinvents the wheel). `unique-names-generator` is already present and purpose-built.

---

## MCP Tool Placement: `server/world-api/src/mcp-server.ts`

**Decision**: Group MCP tools (`group.offer`, `group.vote`, `group.leave`, `group.say`, `group.list`) are registered in `server/world-api/src/mcp-server.ts`, following the exact pattern of existing tools (`go`, `say`, `inventory`, `offer`, `agree`).

**Rationale**: All ghost-facing MCP tools live in `mcp-server.ts`. The constitution requires MCP-first interfaces. No new file is needed — the tool registration follows the established `switch`/`handler` pattern in `mcp-server.ts`.

---

## Test Strategy

**Decision**: Unit tests (in-memory `GroupService`, no live Neo4j) ship in the same change as implementation. Integration tests (Neo4j-backed, skipped when `NEO4J_URI` unset) are planned in the same change and may land separately if CI infrastructure is unavailable.

**Rationale**: Matches the constitution's service testing requirements. `GroupService` will have an in-memory implementation (`GroupServiceInMemory`) for unit tests, following the exact pattern of `LedgerServiceInMemory`.
