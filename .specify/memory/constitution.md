<!--
Sync Impact Report
- Version change: template -> 1.0.0
- Modified principles:
  - Template principle 1 -> I. Proposal-First Delivery
  - Template principle 2 -> II. Boundary-Preserving Design
  - Template principle 3 -> III. Verifiable Increments
  - Template principle 4 -> IV. Contract-Explicit Interfaces
  - Template principle 5 -> V. Contribution Hygiene
- Added sections:
  - Implementation Constraints
  - Review and Quality Gates
- Removed sections:
  - None
- Templates requiring updates:
  - ✅ updated `.specify/templates/plan-template.md`
  - ✅ updated `.specify/templates/spec-template.md`
  - ✅ updated `.specify/templates/tasks-template.md`
- Runtime guidance reviewed:
  - ✅ reviewed `README.md`
  - ✅ reviewed `docs/architecture.md`
  - ✅ reviewed `CONTRIBUTING.md`
  - ✅ reviewed `AGENTS.md`
- Deferred items:
  - None
-->

# aie-matrix Constitution

## Core Principles

### I. Proposal-First Delivery
Non-trivial changes MUST begin with a written proposal before implementation.
Feature work belongs in an RFC under `proposals/rfc/`; architectural decisions,
cross-cutting technology choices, and costly-to-reverse structure changes belong
in an ADR under `proposals/adr/`. Plans, tasks, and implementation branches MUST
trace back to that proposal. Small, well-understood fixes MAY proceed with a PR
description only when they do not alter architecture, public contracts, or repo
structure.

### II. Boundary-Preserving Design
Implementations MUST preserve the architectural boundaries documented in
`docs/architecture.md` and ratified ADRs. Contributors MUST state which package
or subsystem owns each behavior, data contract, and integration point. PoC
shortcuts are allowed only when they are explicitly called out as temporary,
scoped to local development, and documented so they are not mistaken for the
target production design.

### III. Verifiable Increments
Each feature plan MUST define independently demonstrable user slices and a
concrete verification path for each slice. Documentation-only changes MUST be
verified for internal consistency and link integrity. Any change that adds
runnable code MUST also add at least one smoke test or equivalent executable
verification step, and the package README or quickstart MUST document how to run
it locally.

### IV. Contract-Explicit Interfaces
Every interface shared across packages, processes, or languages MUST have an
explicit contract artifact before implementation is considered complete. Acceptable
artifacts include tool schemas, API specs, message formats, data model docs, and
TCK expectations. Contract changes MUST identify downstream consumers and update
their documentation, fixtures, or compatibility checks in the same change.

### V. Contribution Hygiene
All work MUST happen on branches, flow through pull requests, and use imperative,
scoped commit messages with DCO sign-off (`git commit -s`). Repository additions
MUST stay minimal: new top-level directories require proposal justification, new
files should follow existing naming conventions, and Markdown should remain short,
explicit, and repository-specific. Contributors MUST prefer the smallest change
that satisfies the proposal and defer speculative expansion.

## Implementation Constraints

The repository is specification-first and documentation-heavy until a proposal
explicitly introduces runnable packages. Plans MUST name the intended source
layout, dependencies, testing approach, and local developer commands instead of
assuming an application scaffold already exists.

When code is introduced, package-level documentation MUST state setup, smoke-test,
and ownership expectations. Cross-language support MUST be treated as a design
constraint when proposals claim it; stubs are acceptable for a PoC only if the
plan states what is intentionally deferred.

## Review and Quality Gates

Every plan and pull request MUST pass these checks:

- Proposal linkage is explicit and matches the scope of the change.
- Architecture changes either follow an accepted ADR or include a new ADR.
- Public or shared interfaces have updated contract documentation.
- Verification steps are documented and were actually run, or the omission is
  called out with a reason.
- Documentation touched by the change remains consistent with `README.md`,
  `docs/architecture.md`, `docs/project-overview.md`, and `CONTRIBUTING.md`.

Reviews SHOULD prioritize behavioral regressions, boundary violations, contract
drift, and missing verification before style-level comments.

## Governance

This constitution overrides conflicting local habits and template defaults.
Amendments require a documented rationale in the change that introduces them and
MUST update any affected Spec Kit templates in the same change. Versioning follows
semantic versioning for governance:

- MAJOR: removes or materially redefines a principle or gate.
- MINOR: adds a new principle, section, or mandatory workflow requirement.
- PATCH: clarifies wording without changing intent.

Compliance is checked during proposal review, planning, task generation, and pull
request review. `AGENTS.md`, `README.md`, and the files under `.specify/templates/`
are the operational guidance that MUST stay aligned with this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-04-12 | **Last Amended**: 2026-04-12
