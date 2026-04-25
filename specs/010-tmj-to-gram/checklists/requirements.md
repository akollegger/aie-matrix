# Specification Quality Checklist: Map Format Pipeline

**Purpose**: Validate specification completeness and quality before proceeding to planning  
**Created**: 2026-04-25  
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] All mandatory sections completed
- [x] Scope is clearly bounded (CLI + MapService + HTTP endpoint; Colyseus internals untouched)
- [x] Out of scope items explicitly named
- [x] Proposal linkage is explicit (RFC-0009, ADR-0005)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable (byte-identical output, pixel-diff = 0, latency budget)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified (missing sidecar, unknown tile type, missing layout layer, no portal nodes)
- [x] Dependencies and assumptions identified (h3-js, @relateby/pattern, fast-xml-parser already in repo)

## Requirement Coverage

- [x] FR-001–FR-015: CLI package, inputs, translation rules, tile-area conversion, determinism
- [x] FR-016–FR-020: MapService Layer, startup validation, HTTP endpoint, error wiring
- [x] IC-001: .map.gram format (document header, definitions, nodes, determinism, validation rules)
- [x] IC-002: HTTP API (path, query params, responses, contract tests)
- [x] IC-003: CLI interface (exit codes, warning/error message formats, CI usage pattern)
- [x] SC-001–SC-008: measurable outcomes covering conversion correctness, serving, CI, and startup

## Feature Readiness

- [x] All user stories have independent acceptance tests
- [x] Priority ordering is clear (CLI first unblocks everything else)
- [x] Three-layer test strategy is fully specified (structural invariants, golden CI, pixel-diff)
- [x] Migration sequence matches RFC-0009 step order
- [x] No changes to `server/colyseus/src/` — Colyseus boundary preserved

## Open Questions to Resolve Before Planning

- RFC-0009 Open Question 9 (polygon-to-cells provider: `h3.polygonToCells` vs flood-fill) should be resolved before implementing tile-area compression. The spec assumes option (a) per the RFC suggestion; plan should confirm and note the decision.
- RFC-0009 Open Question 4 (`mapId` namespacing) is punted to a follow-up; the startup-error approach is locked in here. No blocker.
- Visual hint authoring (RFC-0009 Open Question 6) is left blank in the gram for now. Layer 3 test uses the fallback table in `tools/tmj-to-gram/test/render/fallbacks.ts`. No blocker.

## Notes

- The Layer 3 pixel-diff test requires `maps/sandbox/map-with-polygons.tmj` to be authored before the test can run. This fixture must be created as part of the feature work, not as a pre-condition.
- RFC-0009's migration sequence (step 2: regenerate and re-commit sandbox `.map.gram` files) must happen in the same PR as the CLI landing — otherwise CI byte-equality will fail on the committed `freeplay.map.gram` the user authored manually.
