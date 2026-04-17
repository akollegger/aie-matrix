# Data Model: Rule-Based Movement

**Feature**: `003-rule-based-movement`  
**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

## Overview

Movement policy is **authored** as Gram text, **parsed** into relateby `Pattern<Subject>`, and **evaluated** against a **runtime snapshot** built from the map and ghost (also expressed as `Subject` values for matching).

## Entities

### Rules file (artifact)

| Field | Description |
|-------|-------------|
| Path | Repository file, e.g. `server/world-api/rules/sandbox.rules.gram` |
| Contents | Gram notation: one or more patterns (typically relationship edges between labeled subjects) |
| Lifecycle | Read at startup or when configuration is loaded; parse errors fail fast with a clear log message |

### Parsed ruleset (runtime)

| Field | Type (conceptual) | Description |
|-------|-------------------|-------------|
| `patterns` | `ReadonlyArray<Pattern<Subject>>` | Output of `Gram.parse` on the rules file(s) |
| `graphView` | Optional derived graph | `StandardGraph` / `GraphView` from `@relateby/pattern` for indexed queries (implementation choice) |
| `mode` | `authored` \| `permissive` | `permissive` skips graph matching and allows all geometrically valid steps (FR-005) |

### Tile class labels (logical)

| Field | Description |
|-------|-------------|
| Labels | Set of strings (e.g. `Hallway`, `VIP`, `Blue`) attached to a map cell’s class |
| Encoding (PoC) | Interim: parse from existing `tileClass` string (e.g. split on `:`) **or** extend map schema to explicit arrays — see research §5 |

### Ghost attributes (evaluation)

| Field | Description |
|-------|-------------|
| Identifiers | Ghost id, caretaker id (existing) |
| Policy fields | Optional labels/roles used in rules (e.g. `ghostClass: Attendee`) — sourced from registry/adoption metadata when available |

### Evaluation snapshot (per `go` request)

Built in memory; not persisted as a single “world graph” document.

| Part | Maps to |
|------|---------|
| Origin tile | `Subject` with identity = tile id or class key, `labels` = tile’s label set, optional `properties` (occupancy, lights, … when rules need them) |
| Destination tile | Same shape for neighbor cell |
| Acting ghost | `Subject` with ghost id and constraint fields as properties/labels |
| Compass | Filter on relationship property `toward` (and geometric resolution already done in `resolveNeighbor`) |

### Denial feedback

| Field | Description |
|-------|-------------|
| `code` | Stable machine string (e.g. extend beyond `RULESET_DENY` with subcodes if needed) |
| `reason` | Human-readable explanation |

## Validation rules

1. **Gram parse**: Invalid Gram MUST prevent rules mode from activating (fail closed) or fall back to permissive only if explicitly configured — default should be **fail closed** for operator safety.
2. **Allow-list**: If no rule edge matches origin, destination, direction, ghost constraints, and conditions, the move is **denied**.
3. **Geometry first**: `NO_NEIGHBOR`, `UNKNOWN_CELL`, etc. are unchanged and evaluated **before** rules (existing `movement.ts` ordering preserved).

## State transitions (movement)

```
[request go toward T]
  → validate cell + neighbor
  → if permissive mode → allow
  → else match ruleset against snapshot
  → permit (update position) | deny (unchanged position + code/reason)
```

## Relationships

- **Rules file** 1—N **Pattern** (parse result).
- **Map cell** N—1 **tile class labels** (conceptually; implementation may denormalize).
- **Ghost** N—1 **attribute bundle** for rule constraints.
