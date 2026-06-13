# Research: Migrate funder-agent into npc-agent

**Feature**: 029-funder-into-npc  
**Date**: 2026-06-13

## R-001 — Gram parser extensibility for optional `behaviorKind`

**Decision**: Read `behaviorKind` as optional in `parseCharacterGramText`; default to `"rule-engine"` when absent.  
**Rationale**: `strProp` returns `undefined` for absent keys — zero risk to existing gram files. Existing characters silently inherit the default.  
**Alternatives considered**: Requiring `behaviorKind` in all gram files — rejected because it forces edits to three existing files with no behavioral change.

## R-002 — Dialog tree requirement for funder gram file

**Decision**: Add a minimal stub dialog tree to `funder.character.gram`. Parser unchanged.  
**Rationale**: A single idle node with a wildcard self-loop satisfies the parser invariant. The stub is never reachable via the funder behavior path, so it carries no runtime cost.  
**Alternatives considered**: Making `HAS_DIALOG` optional when `behaviorKind === "funder"` in the parser — rejected because it leaks behavior-kind semantics into the gram format layer and complicates future character types.

## R-003 — Funder tick integration into Effect fiber loop

**Decision**: Inline conditional dispatch inside the existing tick `tryPromise` in `ghostActionLoop`.  
**Rationale**: The existing `tryPromise` + non-fatal `catchAll` structure already handles both success and failure. Adding one `if` branch before `evaluateRules` is the smallest possible change. Snapshot building is skipped for `behaviorKind === "funder"` since the funder polls inbox directly.  
**Alternatives considered**: Abstracting a `BehaviorHandler` interface — rejected as premature; two behavior kinds don't justify a strategy pattern.

## R-004 — State clearing on re-spawn

**Decision**: Export `clearFunderState(ghostId)` from `funder-behavior.ts`; call it from `launchGhostLoop` after fiber interrupt, before fork.  
**Rationale**: `launchGhostLoop` is the single point where a prior ghost loop is replaced. Clearing state here guarantees no dangling contract entries survive a re-spawn.  
**Alternatives considered**: Clearing state inside `funderTick` on startup — rejected because it runs after the new fiber has started, creating a brief window where stale state is visible to an incoming event.
