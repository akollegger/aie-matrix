# Feature Specification: A2A Ghost House Proof-of-Concept Spike

**Feature Branch**: `008-a2a-ghost-house-spike`  
**Created**: 2026-04-24  
**Status**: Draft  
**Input**: User description: "A spike of the a2a protocol as described in `proposals/spikes/spike-a2a-ghost-house-poc.md` — validate TypeScript A2A SDK maturity and third-party contributor model before ADR-0004 acceptance and RFC-0007 implementation."

> **Specification type**: Time-boxed **research spike**. Primary deliverables are **written reports** that gate architecture decisions; any executable artifacts are explicitly throwaway and **must not** ship into the production codebase.

## Proposal Context *(mandatory)*

- **Related Proposal**:
  - Spike charter: [`proposals/spikes/spike-a2a-ghost-house-poc.md`](../../proposals/spikes/spike-a2a-ghost-house-poc.md)
  - Decision record (gated by this spike): [`proposals/adr/0004-a2a-ghost-agent-protocol.md`](../../proposals/adr/0004-a2a-ghost-agent-protocol.md)
  - Target architecture: [`proposals/rfc/0007-ghost-house-architecture.md`](../../proposals/rfc/0007-ghost-house-architecture.md)
- **Scope Boundary**:
  - **Spike A (1 day)**: Exercise the chosen TypeScript A2A client/server SDK against four interaction patterns: one synchronous task round-trip, one streaming task with multiple agent-side updates, one push-style notification from host to an agent webhook, and agent-card publish plus discover.
  - **Spike B (1 day, reusing Spike A scaffold where practical)**: Skeleton “ghost house” (A2A host + catalog only — no Colyseus bridge, no MCP proxy) plus a minimal contributed agent (single deployable unit) that declares an agent card, registers with the catalog, is spawned by the house, receives one simulated world-style event, and emits one structured response.
  - **Reporting**: Each spike produces a 1–2 page writeup (what worked, what did not, learnings for ADR/RFC, recommendation: proceed / proceed with changes / reconsider). Combined findings are suitable for appendix material in ADR-0004 and cross-reference from RFC-0007 Open Questions.
- **Out of Scope**:
  - Colyseus bridge, live world integration, MCP proxy (per spike charter).
  - Authentication design and production hardening (auth remains a named open question; local-only unauthenticated flows are acceptable).
  - Shipping spike code into this monorepo or any long-lived service.
  - Validating all ghost tiers; **Wanderer**-level behavior is sufficient for both spikes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Core Team Validates SDK Readiness (Priority: P1)

A maintainer runs Spike A and records whether the reference SDK supports the four interaction patterns end-to-end without undocumented workarounds, whether the programming model is legible, and whether any defects block the ghost-house use cases called out in ADR-0004 / RFC-0007.

**Why this priority**: If the SDK is immature, implementation effort and schedule in RFC-0007 are wrong; this is the primary technical risk the spike exists to surface.

**Independent Test**: Evidence pack (logs, screen recording, or scripted transcript) plus the Spike A report demonstrates each of the four patterns completing successfully, **or** documents a concrete failure signal with reproduction notes.

**Acceptance Scenarios**:

1. **Given** Spike A time box (one working day), **When** the maintainer completes the scripted exercises, **Then** the Spike A report states pass/fail for synchronous task, streaming task, push notification, and agent-card publish/discover, each with observable evidence.
2. **Given** a failure in streaming or push notification, **When** root cause is SDK limitation versus operator error, **Then** the report labels it as an escalation item to ADR-0004 with a clear recommendation.

---

### User Story 2 — Simulated Third Party Validates Contribution Friction (Priority: P2)

A contributor with no prior ghost-house context follows only the spike-provided scaffold and instructions, implements the minimal agent, registers it, and reaches a successful spawn plus one event/response cycle.

**Why this priority**: Vendor adoption for AI Engineer World's Fair 2026 depends on low friction; Spike B measures real calendar time and procedural clarity.

**Independent Test**: A timed run (wall clock) from “zero context” to “house logs show spawn + one handled event” is captured in the Spike B report, with a list of every prerequisite step (install, env vars, URLs).

**Acceptance Scenarios**:

1. **Given** the skeleton ghost house and contributor readme from Spike B, **When** a participant not on the core team performs the exercise, **Then** the Spike B report records whether wall-clock time stayed under four hours.
2. **Given** the exercise completes within the time box, **When** the contributor reviews required infrastructure, **Then** the report confirms whether anything beyond a Node.js runtime and a reachable HTTP endpoint was necessary for local development.

---

### User Story 3 — Architecture Owners Receive Gating Recommendations (Priority: P3)

Project leads read both spike reports and know whether to accept ADR-0004 as-is, amend it, or pause RFC-0007 implementation — and which RFC sections require edits (agent card shape, networking assumptions, open questions).

**Why this priority**: The spike succeeds when it **informs** a decision, even if the technical outcome is “do not proceed without changes.”

**Independent Test**: The combined documentation package contains explicit “Recommendation” sections aligned to ADR/RFC owners, without requiring them to read throwaway code.

**Acceptance Scenarios**:

1. **Given** completed Spike A and Spike B reports, **When** an architecture owner reads only the executive summaries, **Then** they can state “proceed / proceed with changes / reconsider” with cited evidence.
2. **Given** any failure signal from the spike charter (SDK gaps, >4h contributor friction, agent-card schema mismatch, NAT/public-endpoint blockers), **When** the ADR/RFC authors review findings, **Then** at least one concrete documentation change is identified or explicitly deferred with rationale.

---

### Edge Cases

- **Partial completion inside time box**: The report must still document what was attempted, partial results, and whether the remainder is estimated to fit another half-day — escalation is allowed.
- **Environment-only failures** (firewall, corporate proxy): Distinguish in the report from SDK defects; still counts toward “networking practical blocker” if typical contributors would hit it.
- **Operator error vs SDK bug**: Each failure must state which category applies before recommending ADR changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Spike A MUST demonstrate a host-initiated task where the agent returns a final result in a single round-trip suitable for treating as a synchronous interaction.
- **FR-002**: Spike A MUST demonstrate a host-initiated streaming task where the agent emits multiple incremental updates before completion.
- **FR-003**: Spike A MUST demonstrate the host pushing an event to an agent-registered webhook (or equivalent push surface defined by the protocol/SDK) without the agent polling for that specific event.
- **FR-004**: Spike A MUST demonstrate publishing an agent card and discovering it from the host perspective (or documented equivalent discovery flow required for catalog integration).
- **FR-005**: Spike B MUST provide a single documented entry path for an external agent to register with the skeleton catalog (command, HTTP call, or config file — exactly one primary path, clearly named in the readme).
- **FR-006**: Spike B MUST show the house spawning a registered agent instance (or protocol-equivalent “session start”) that is distinguishable in logs or traces from registration alone.
- **FR-007**: Spike B MUST deliver one synthetic “world event” into the spawned agent and capture one agent-emitted response suitable for comparison against RFC-0007’s assumed message shapes (exact schema match is not required; gaps must be listed explicitly).
- **FR-008**: Each spike MUST produce a written report containing the four sections: *What worked*, *What didn’t*, *What we learned (ADR/RFC deltas)*, *Recommendation*.
- **FR-009**: The combined findings MUST be suitable to paste or merge as an appendix to ADR-0004 and MUST call out any RFC-0007 Open Question updates by section reference.

### Key Entities *(include if feature involves data)*

- **A2A Host (“house” skeleton)**: Initiates tasks, maintains catalog/registry state for Spike B, delivers simulated events.
- **A2A Agent (contributed sample)**: Exposes card, handles tasks/stream/push per exercises, emits responses.
- **Agent Card**: Advertised capabilities and endpoints; subject of publish/discover and schema completeness review vs RFC-0007.
- **Catalog / Registry**: Logical store mapping registered agents to spawn metadata (exact storage is spike-internal).
- **Spike Reports**: Durable artifacts; supersede throwaway code as the source of truth for decisions.

### Interface Contracts *(mandatory when crossing package/process/language boundaries)*

- **IC-001**: Agent card fields assumed by RFC-0007 MUST be enumerated during Spike B and marked *supported*, *supported with workaround*, *missing*, or *not applicable* — with implications called out for the RFC.
- **IC-002**: Event + response payload shapes used in Spike B MUST be captured in the report (appendix tables encouraged) so RFC-0007 authors can diff them against the proposed ghost-house message contracts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Spike A completes within one working day or stops early with a written escalation that meets FR-008/FR-009.
- **SC-002**: Spike B completes within one working day or stops early with a written escalation that meets FR-008/FR-009.
- **SC-003**: For Spike B, a cold contributor (not previously on the task) reports wall-clock time from start to successful spawn plus one handled event; the Spike B report states whether that time was **under four hours**.
- **SC-004**: Within three working days of spike kickoff (optional writeup buffer per charter), ADR-0004 and RFC-0007 owners can point to at least one concrete documentation action triggered by the spike (appendix merged, section revised, or explicit “no doc change” with justification).

## Assumptions

- Investigators have permission to install packages and run local HTTP services on developer machines.
- “Production-ready” in the spike charter is interpreted as **fit for the ghost-house coordination layer** described in ADR-0004, not certification for arbitrary enterprise deployments.
- Wanderer-tier depth is enough; deeper tier behaviors are explicitly out of scope.
- Authentication may be stubbed; absence of auth MUST still appear as a tracked open question in the report, not silently ignored.

## Documentation Impact *(mandatory)*

- **ADR-0004**: Add spike appendix (combined report) prior to acceptance; link from main ADR body as evidence for the decision.
- **RFC-0007**: Update Open Questions / assumptions section to reference the spike appendix where findings apply.
- **Spike charter** (`proposals/spikes/spike-a2a-ghost-house-poc.md`): Optional status flip from *proposed* to *completed* once reports land — only if maintainers want the spike file to mirror execution state.
