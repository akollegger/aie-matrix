# Research: Rule-Based Movement (Gram + @relateby/pattern)

**Feature**: `003-rule-based-movement`  
**Spec**: [spec.md](./spec.md) · **RFC**: [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md)

## 1. Rules authoring: Gram text files

### Decision

Author movement policy as **Gram notation** in repository files (for example `sandbox.rules.gram` or `rules/demo-asymmetric.gram`). Files are loaded at process startup (or first room attach), parsed into in-memory structures, and used by `evaluateGo`.

### Rationale

- Matches RFC-0002’s “typed-relationship graph” model: Gram expresses **subjects** (tile classes as labeled nodes) and **relationships** (e.g. `GO` with properties such as direction and ghost constraints).
- Text diffs, review, and corpus tests are straightforward for contributors.
- Aligns with the broader relateby ecosystem (canonical JSON round-trips, shared notation with `pattern-hs` tooling where applicable).

### Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| JSON/YAML rules only | Loses the concise graph notation; still possible as an export format later. |
| Neo4j as authoring store | Heavy for local PoC; RFC already defers live DB for rules. |
| Hardcoded TypeScript only | Violates “swap ruleset without code change” from the spec. |

---

## 2. Dependency: `@relateby/pattern` (npm)

### Decision

Add **`@relateby/pattern`** (current registry version **0.2.9**) as a dependency of `@aie-matrix/server-world-api`.

### Rationale

- The package exposes **`Gram.parse` / `Gram.stringify` / `Gram.validate`** as `Effect` APIs and returns **`ReadonlyArray<Pattern<Subject>>`** — parsing `.gram` files does **not** require a separate `@relateby/gram` npm package (that name is **not** published on the public registry as of this research; Gram lives inside `@relateby/pattern`).
- **Peer dependency**: `effect >= 3.0.0` — matches this repo’s Effect-ts orchestration layer.
- Ships **graph views** (`StandardGraph`, `toGraphView`, transforms) suitable for querying relationship-typed edges after parse.

### Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Separate `@relateby/gram` | Not available on npm; functionality is bundled in `@relateby/pattern`. |
| Rust crate via N-API only | Extra build complexity; TS port already maintained. |

---

## 3. Can Pattern structures represent the **rule graph**?

### Decision

**Yes.** Parsed Gram → `Pattern<Subject>` (and derived graph views) is the **canonical in-memory representation** of the **ruleset graph** for this feature.

### Rationale

- Rules are **static policy**: nodes are tile-class identities with **label sets**; edges are action-typed relationships with optional **properties** (`toward`, `ghostClass`, etc.). This maps directly to `Subject` (identity, labels, properties) and relationship patterns in Gram.
- Multi-label tile classes (RFC) align with `Subject.labels` as a `HashSet` of strings.

### Caveats

- **Allow-list semantics** (deny unless a rule permits) are enforced by the **evaluator**, not by the graph structure alone: implementation must scan matching edges and apply ghost/tile/direction filters.

---

## 4. Can Pattern structures represent the **world graph**?

### Decision

**Partially — use Pattern/Subject for snapshots, not as the authoritative runtime store.**

| Concern | Approach |
|--------|----------|
| **Authoritative world state** | Remains **Colyseus `LoadedMap` + room state** (per `docs/architecture.md` and existing PoC). No requirement to persist the whole world as a Gram document. |
| **Evaluation-time “world slice”** | For each `go` request, build one or more **`Subject` instances** representing **origin tile**, **destination tile**, and **acting ghost** (labels + relevant properties). These are **ephemeral** values passed into matching logic against the parsed rule patterns. |
| **Long-term Neo4j world graph** | Architecture mentions Neo4j for broader goals; **out of scope** for this movement slice. When Neo4j is used later, **export or query** into the same `Subject`-shaped snapshot for evaluation is plausible without changing the rules side. |

### Rationale

- The RFC’s “world state graph” is about **instances and dynamic properties**. Relateby `Subject` is designed for **indexed, labeled, property-bearing** nodes — a good fit for **context**, not a mandate to mirror every Colyseus cell as a persisted `Pattern`.
- Forcing the entire map into a `StandardGraph` on every move would add **allocations and complexity** without user-visible benefit for adjacent-only `GO`.

### Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Build full `StandardGraph` of all tiles each move | O(tiles) work per `go`; unnecessary for adjacency checks. |
| Represent world only as plain strings | Loses a unified model with rules and future property conditions. |

---

## 5. Open points for implementation (non-blocking)

1. **Tile multi-label encoding in `LoadedMap`**: Today `tileClass` is a single string; labels may be encoded as **colon-separated** tokens or upgraded to **string[]** in map/shared types — choose in implementation with a small migration for sample maps.
2. **Graph query strategy**: Whether to use **`toGraphView` / `StandardGraph`** walks vs. a dedicated small matcher over `Pattern<Subject>` — profile after first vertical slice; both are valid.
3. **WASM vs JS**: `@relateby/pattern` bundles WASM adapters; default path should use the package’s public API and only optimize if benchmarks require it.

---

## References

- npm: `@relateby/pattern@0.2.9` — includes `Gram`, `Pattern`, `Subject`, graph modules.
- [RFC-0002](../../proposals/rfc/0002-rule-based-movement.md)
- [pattern-rs](https://github.com/relateby/pattern-rs) (upstream)
