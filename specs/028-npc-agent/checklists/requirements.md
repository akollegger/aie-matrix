# Specification Quality Checklist: NPC Agent — Rule-Based Character Roster

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- All items pass. Specification is ready for `/speckit.plan`.
- SC-006 ("zero LLM API calls") is unusual for an aie-matrix agent and is an explicit design constraint, not a default assumption — intentionally included.
- IC-003 confirms no new MCP tools are needed; this constrains the behavioral rule vocabulary to existing tool calls.
- **Conversation-participation correction**: the random-agent only replies to `PARTNER`-priority (human) messages and drops ghost-originated `DIRECT`/`NEAR`/`GROUP` messages (see `ghosts/random-agent/src/executor.ts:321` and `server/conversation/src/router.ts:93`). US3/FR-008 were revised so NPCs enter the dialog tree for messages addressed to them by any ghost (`DIRECT`) as well as human partners (`PARTNER`). FR-011 bounds NPC↔NPC loops; FR-014/SC-007 require an external-ghost integration test.
- **Concurrent-conversation coverage**: FR-012 requires per-partner dialog state; US3 scenarios 5 & 7, FR-015(b), and SC-008 require integration coverage proving two simultaneous interleaved conversations track independent state with no cross-contamination.
- **Clarifications resolved (2026-06-10)**: (1) NPCs ignore sibling-NPC messages — NPC↔NPC out of scope, no turn cap (FR-009; replaced old loop-bound FR-011). (2) Roster spawn triggered by `world.session.start` self-spawn via agent-host spawn API (FR-004, IC-006; dependency flagged for planning). (3) Dialog triggers use case-insensitive keyword/substring matching (FR-010). (4) Catalog files are gram (`.character.gram`) via `@relateby/pattern`, not JSON/YAML (FR-001, IC-001). FRs renumbered to 001–015.
