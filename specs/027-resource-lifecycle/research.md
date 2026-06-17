# Research: Resource Lifecycle (027)

All unknowns resolved from codebase inspection. No external research required.

## Finding 1 — Current spawn grant mechanism

**Decision**: Replace module-level `_catalogGrants` / `CatalogResourceGrant` with a map-level `SpawnGrant` parsed at session init, keyed by role string from `agentCard.metadata.role`.

**Rationale**: Catalog grants are agent-specific and require per-agent configuration outside the map. Map-level grants are declared by the map author alongside item placements, keeping the world definition self-contained.

**Alternative rejected**: Keep catalog grants as a parallel path — rejected because it maintains the same dual-system problem the branch is meant to eliminate.

## Finding 2 — `resourceTypes()` consumer in ProposalService

**Decision**: Replace `ledger.resourceTypes()` call (ProposalService.ts:152) with `ItemService.getSidecar().has(resourceId)`.

**Rationale**: The only purpose of the call is to validate that both sides of a trade reference known item types. The item sidecar (derived from map ItemType declarations) is the authoritative registry.

**Alternative rejected**: Keep a resource type registry inside the ledger — rejected because it duplicates the sidecar and requires registration calls that this branch removes.

## Finding 3 — `LedgerService.init()` seed format

**Decision**: Change `init(seed: ResourceType[])` to `init(seed: ItemSeed[])` where `ItemSeed = { itemRef: string; qty: number; h3Index?: string }`. Genesis transfers mint to `"world@{h3Index}"` when h3Index present, otherwise to `"world"`.

**Rationale**: Placement-derived seeds know the tile; spawn-grant pool items don't need a tile location. This matches the actor ID convention (Q1 clarification).

## Finding 4 — `initialItemRefs` expansion for qty

**Decision**: Expand qty by repeating the itemRef string: `["GoldCoin", "GoldCoin"]` for qty 2. No type signature change to `initialItemRefs: string[]`.

**Rationale**: Minimises consumer changes in Colyseus and client code. The flat array is already consumed correctly everywhere.

**Alternative considered**: `{ itemRef: string; qty: number }[]` — better semantically but breaks all consumers; deferred as a future cleanup.

## Finding 5 — `mechanics.ts`

**Decision**: Delete the monotonic mint helpers (`awardXp`, movement cost helpers). If the file is empty after removal, delete it.

**Rationale**: Monotonic resources are out of scope. Eval payout uses `ledger.commit()` directly with `cause: "eval-payout"`.

## Finding 6 — `EvalContractService` group payout

**Decision**: Add group payout path in `EvalContractService`: when contract target is a group, read the frozen member list stored at acceptance time, split `floor(total / memberCount)`, commit individual transfers per member, return remainder to `"world"`.

**Rationale**: Matches FR-013 and US-6. The group bag is not involved.
