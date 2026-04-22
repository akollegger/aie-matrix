# Research: World Objects

**Feature**: specs/007-world-objects  
**Date**: 2026-04-22

## Decision 1: Object World State — In-Memory vs Neo4j

**Decision**: Track object placement in-memory using a `Map<h3Index, Set<objectRef>>` for tile placements and a `Map<ghostId, objectRef[]>` for ghost inventories inside a new `ObjectService` Effect service in `server/world-api/`. Do not write object relationships to Neo4j for the PoC.

**Rationale**: Neo4j is optional (`NEO4J_URI` must be set; many dev environments run without it). RFC-0006's world-state Cypher graph (`HAS_OBJECT`/`CARRIES` nodes and relationships) is an accurate description of the semantic model, but wiring it as Neo4j writes would gate the feature on a running Neo4j instance and require driver sessions, transactions, and error mapping for every `take`/`drop` call. In-memory structures deliver the same observable behavior — ghost agents can pick up, carry, and drop objects correctly — at a fraction of the complexity. The Neo4j model from the RFC should be adopted when object state needs to survive server restarts or cross-process queries (deferred per RFC-0006 open question). The RFC data model remains the reference; `ObjectService` is the PoC bridge.

**Alternatives considered**:
- Full Neo4j write path: correct target architecture, but blocks dev environments without Neo4j and adds neo4j session/tx boilerplate to every object mutation.
- Colyseus MapSchema: would give Phaser spectators real-time updates automatically, but mixes object placement state into the room schema, which is owned by `server/colyseus/`. Object state broadcast to Colyseus should be an explicit push from `ObjectService` to the Colyseus bridge (same pattern as ghost mode in Decision 2 of 006-ghost-conversation).

**RFC alignment**: RFC-0006 describes Neo4j relationships as the world-state model. This PoC deviation must be reflected in `research.md` and the RFC `Open Questions` section updated to note that Neo4j persistence is deferred. No RFC content change required for the data model — the in-memory structure is a faithful implementation of the same conceptual model.

---

## Decision 2: Object State — Broadcast to Colyseus

**Decision**: On every `take` and `drop` mutation, `ObjectService` calls a new `WorldBridgeService` method `setTileObjects(h3Index, objectRefs[])` that sets a Colyseus `MapSchema<string>` of `h3Index → comma-separated objectRef list`. A separate `MapSchema<string>` for `ghostId → comma-separated objectRef list` broadcasts ghost inventories.

**Rationale**: FR-014 requires that object world state is broadcast to Colyseus so the data pipeline is ready when the Phaser client RFC lands. A flat `MapSchema<string>` with comma-separated lists is the lowest-friction Colyseus schema extension — the same pattern already used for `ghostTiles` and `ghostModes`. A structured `MapSchema<SomeSchema>` would require a new Colyseus `@Schema` subclass. Since the Phaser rendering is deferred, the flat string is sufficient for the data to flow.

**Alternatives considered**:
- Structured Colyseus schema (`MapSchema<ObjectListSchema>`): more ergonomic on the client side, but over-engineers the spectator shape before any client usage is defined.
- Omit Colyseus broadcast entirely: would block the client RFC from building on this feature without an additional server PR.

---

## Decision 3: Map Loader Extension — `object-placement` Layer and Sidecar

**Decision**: Extend `loadHexMap()` in `server/colyseus/src/mapLoader.ts` to accept an optional `objectsPath?: string` parameter (the resolved sidecar path). The caller (`server/src/index.ts` via `ServerConfigService`) is responsible for resolving `AIE_MATRIX_OBJECTS` → absolute path before passing it in. If `objectsPath` is not provided, `loadHexMap()` falls back to the co-located convention (`<map-dir>/<map-basename>.objects.json`). The loader:
1. Reads the sidecar from the resolved path (or co-located fallback). Missing file → empty sidecar, no error.
2. Reads an optional layer named `"object-placement"` from `tmj.layers` (by name, not by index).
3. Returns both in an extended `LoadedMap` type: `objectSidecar: Map<string, ObjectDefinition>` and `initialObjectRefs` per `CellRecord`.

**Rationale**: Decoupling the sidecar from the map path enables mixing different combinations of map, rules, and objects — the same map can be loaded with different object sets by changing `AIE_MATRIX_OBJECTS`, and the same object set can be shared across multiple maps. This follows the exact pattern of `AIE_MATRIX_MAP` + `AIE_MATRIX_RULES`: each resource type has its own env var and an independent default. The loader itself does not read `process.env` — path resolution stays in `ServerConfigService` and `parseServerConfigFromEnv()`, consistent with how `mapPath` is already handled.

**`AIE_MATRIX_OBJECTS` env var**:
- Unset → fall back to co-located `<map-dir>/<map-basename>.objects.json` (backward-compatible default)
- Set to an absolute path → use that file
- Set to a relative path → resolved relative to repo root (same convention as `AIE_MATRIX_RULES`)
- File not found at the resolved path → startup error (explicit path implies intent; a missing co-located sidecar is a soft default)

**`ServerConfig` gains**:
```
objectsPath: string | undefined   // undefined = use co-location fallback
```

**Alternatives considered**:
- Always co-locate (original design): simple, but prevents mixing object sets without duplicating the sidecar or symlinking files. Rules and maps are already decoupled by env var; objects should be too.
- Load sidecar separately in `ObjectService`: requires exposing the path outside the config layer; duplicates path resolution.
- Extend `mapLoader.ts` only for tileset `objects` properties but handle the `object-placement` layer in `ObjectService`: splits map-parsing concerns across two packages.

---

## Decision 4: `ObjectService` Package Placement

**Decision**: Add `ObjectService` as an Effect `Context.Tag` service in `server/world-api/src/ObjectService.ts`. It is not a new package.

**Rationale**: The feature adds `inspect`, `take`, `drop`, and `inventory` MCP tools — all in `server/world-api/`. The `ObjectService` is logically a peer of `WorldBridgeService` and `MovementRulesService`. Creating a new `server/objects/` package would require a new `package.json`, build config, and inter-package import — unjustified for five new exported functions. No new top-level repository directories or packages are introduced.

**Alternatives considered**:
- Separate `server/objects/` package: correct for a long-lived subsystem, but adds monorepo overhead for the PoC. Deferred until persistence across restarts becomes a requirement.

---

## Decision 5: Capacity Accounting — Where It Lives

**Decision**: Capacity check for `go` (tile entry) remains in `movement.ts` `evaluateGo()`. A new helper `computeTileEffectiveCapacity(h3Index, ghostCount, objectService)` is added to `movement.ts` and called by `evaluateGo()`. The same helper is also called in the `drop` MCP tool handler. `ObjectService.getObjectsOnTile(h3Index)` returns the current list of object refs; the handler sums their `capacityCost` values using the sidecar.

**Rationale**: `movement.ts` already owns the capacity check for `go`. Centralising the formula in one helper avoids duplication between `go` and `drop`. The helper is pure (takes counts, not services) — easy to unit test.

**Alternatives considered**:
- Capacity check inside `ObjectService`: would require `ObjectService` to know about ghost positions, creating a circular dependency with `WorldBridgeService`.

---

## Decision 6: `objectRef` Identity in MCP Tools

**Decision**: All MCP tools (`inspect`, `take`, `drop`) use `objectRef` (the sidecar key) as the identifier in their `inputSchema`. When a tile has multiple objects with the same `objectRef` (e.g., three chairs), `take` selects the first available relationship and does not expose instance selection to the ghost agent.

**Rationale**: RFC-0006 explicitly resolves the multiplicity question this way: "Ghosts interact with the ref; the world tracks the relationships." No instance numbering is exposed. This keeps the ghost API simple — an LLM agent does not need to track which chair it picked up.

---

## Decision 7: `tilesetParser.ts` Extension for `capacity` and `objects` Properties

**Decision**: `tilesetParser.ts` already captures all tile properties in `ParsedTile.properties: Record<string, string>`. `capacity` is currently parsed by `mapLoader.ts` callers that need it. `objects` will be read from the same `properties` map in the new map loader code — no changes to `tilesetParser.ts` are needed.

**Rationale**: The tileset parser already stores all custom properties generically. This is exactly the extension point needed.

---

## Decision 8: `LoadedMap` and `CellRecord` Extension Strategy

**Decision**: Extend `CellRecord` to add an optional `capacity?: number` (currently absent from the type — it's read by Neo4j seed code directly from the tileset). Add a new `objectSidecar` field to `LoadedMap`. Add `initialObjectRefs` to `CellRecord` to carry the per-cell declared objects from map load time. `ObjectService` consumes `initialObjectRefs` at construction to build its in-memory state.

**Rationale**: `CellRecord` and `LoadedMap` are in `server/colyseus/src/mapTypes.ts`. Extending them is the canonical way to propagate new map-parsed data through the system without duplicating file reads.

**Alternatives considered**:
- A parallel `ObjectLoadResult` returned alongside `LoadedMap`: avoids touching `CellRecord` but requires callers to carry two values everywhere.

---

## Decision 9: `look` Response Extension — Scope

**Decision**: Extend `look { at: "here" }` and `look { at: "around" }` to include objects. `look { at: <compass> }` targeting a single adjacent tile also includes objects on that tile. The `TileInspectResult` interface in `shared/types/` gains `objects?: TileObjectSummary[]` where `TileObjectSummary = { id: string; name: string; at: "here" | Compass }`. `at` is always `"here"` in single-tile results; it carries the compass direction only in `around` aggregated results.

**Rationale**: RFC-0006 specifies that `look here` and `look around` both gain an `objects` field. Including single-compass-face results is consistent — a ghost looking `ne` gets the same tile detail it would see in `around`. Making the field optional (`objects?`) preserves backward compatibility for existing `TileInspectResult` consumers that don't need objects.

---

## Decision 10: `NEEDS CLARIFICATION` — `mapLoader.ts` Multi-Layer Support

**Status**: Resolved via codebase inspection.

The current `loadHexMap()` reads `tmj.layers?.[0]` by array index and the `TmjLayer` interface has no `name` field. The `.tmj` format supports a `name` property on layers. The extension to support an optional `object-placement` layer requires:
1. Adding `name?: string` to `TmjLayer`.
2. After reading layer index 0 as the navigable layer, scanning `tmj.layers` for a layer with `name === "object-placement"`.
3. If found, reading its `data` array with the same grid-to-H3 logic, looking up each cell's tile type from the same tileset, treating that type as an `objectRef`.

This is additive: maps without the layer load unchanged.
