# Phase 0 Research: 008 A2A Ghost House Spike

## Decision: Spike code location

**Rationale**: Product owner / implementer directive: parent folder `spikes/a2a-ghost-agent-protocol/` for all sub-projects; zero imports from production packages.

**Alternatives considered**:

- `packages/a2a-spike-*` — rejected: would join pnpm workspace and blur “throwaway” boundaries.
- `examples/` — rejected: still implies maintained sample code; spike is explicitly disposable.

## Decision: Reference SDK

**Rationale**: ADR-0004 (proposed) and RFC-0007 name `@a2a-js/sdk` at A2A protocol v0.3.0. Spike A exists to validate that choice, not to evaluate competing SDKs first.

**Alternatives considered**:

- Raw HTTP against A2A spec — deferred unless Spike A fails; increases plumbing time inside the time box.

## Decision: Networking model for local dev

**Rationale**: Use `127.0.0.1` with distinct ports per process (host, agent, webhook listener). Document when `localhost` vs `127.0.0.1` matters for webhook callbacks.

**Alternatives considered**:

- Tunneling (ngrok) for push tests — optional appendix in report if localhost-only push is insufficient; not required for initial plan.

## Decision: Auth

**Rationale**: Per spec, authentication is stubbed; every report must list auth as an open question for ADR-0004.

**Alternatives considered**:

- None for spike scope.

## Decision: Report format

**Rationale**: Use the four sections from `spec.md` FR-008 (*What worked*, *What didn’t*, *What we learned*, *Recommendation*) as headings in `reports/spike-a-*.md` and `reports/spike-b-*.md`; combined appendix for ADR is a merge + dedupe pass, not new prose structure.

## Open items for implementer (not blockers for planning)

- Exact npm package version pin for `@a2a-js/sdk` at spike kickoff (record in Spike A report).
- Whether the SDK ships reference server helpers or expects bring-your-own HTTP — discovered during implementation; note in `research.md` follow-up if this file is updated mid-spike.
