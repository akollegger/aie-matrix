# Spike: A2A Ghost House Proof-of-Concept

**Status:** completed (implementation report: `spikes/a2a-ghost-agent-protocol/reports/`)  
**Date:** 2026-04-23  
**Authors:** @akollegger  
**Related:** [ADR-0004](../adr/0004-a2a-ghost-agent-protocol.md) · [RFC-0007](../rfc/0007-ghost-house-architecture.md)

## Purpose

ADR-0004 adopts A2A as the ghost agent protocol and RFC-0007 proposes a
five-component architecture to implement it. Both contain assumptions that can
only be validated by writing code, not by argument:

1. **The TypeScript A2A SDK is ready to use in production today.** If it isn't,
   the ghost house implementation will be dominated by protocol plumbing rather
   than ghost logic, and the timeline assumption in RFC-0007 is wrong.

2. **A third-party contributor can ship a working ghost agent in an afternoon.**
   If it takes longer, the contribution model is broken and needs rethinking
   before AIEWF 2026.

This spike resolves both questions with minimal throwaway code before ADR-0004
is accepted and RFC-0007 enters implementation.

## Scope

Two time-boxed spikes, run back-to-back, sharing as much infrastructure as
possible.

### Spike A: A2A SDK Maturity Check

**Goal:** Determine whether `@a2a-js/sdk` is production-ready for the ghost
house use case.

**Deliverable:** A minimal A2A host and A2A agent in TypeScript that:
- Exchange one synchronous task (host sends message, agent responds)
- Exchange one streaming task (host starts stream, agent emits multiple updates)
- Exchange one push notification (host pushes event to agent webhook)
- Publish and discover an agent card

**Time box:** 1 day.

**Success criteria:**
- All four exchanges work end-to-end without SDK workarounds or custom patches
- Types are coherent and the SDK's API surface is legible
- No showstopper bugs in features the ghost house depends on (streaming, push,
  agent cards)

**Failure signals (escalate to the ADR):**
- SDK requires significant custom work to support streaming or push notifications
- Agent card schema is missing fields the ghost house needs
- TypeScript types are incomplete or incorrect in ways that will compound

### Spike B: Third-Party Contribution Model

**Goal:** Validate that a third-party contributor can ship a working ghost
agent in an afternoon.

**Deliverable:** A skeleton ghost house (A2A host + catalog, no Colyseus
integration, no MCP proxy) plus a one-file Node service implementing a
contributed agent that:
- Declares an agent card
- Registers with the house catalog
- Gets spawned by the house
- Receives one simulated event and emits one response

**Time box:** 1 day.

**Success criteria:**
- Total time for "contributor" to go from zero to running agent: under 4 hours
- Contribution requires no infrastructure beyond Node.js and an HTTP endpoint
- The skeleton ghost house has a single clear entry point for registering an agent
- Authentication is a named open question but not a blocker for local development

**Failure signals (escalate to ADR/RFC):**
- Contribution friction exceeds 4 hours even with a prepared scaffold
- The agent card schema as specified in RFC-0007 is incomplete or wrong
- Networking requirements (public endpoint, firewalls, NAT) are a practical
  blocker for typical vendors

## Non-Goals

This spike does **not** aim to:
- Implement the Colyseus Bridge (Spike B simulates events)
- Implement the MCP Proxy (out of scope; covered by existing ADR-0001 work)
- Solve the authentication model (explicitly deferred by ADR-0004)
- Produce any code that ships into the real system
- Validate all three tiers (Wanderer is sufficient for both spikes)

All spike code is throwaway. The deliverable is a written report, not a
codebase.

## Report Structure

Each spike produces a short writeup (1-2 pages) covering:

- **What worked** — features exercised successfully
- **What didn't** — bugs, missing features, or friction points
- **What we learned** — specifically, what changes to ADR-0004 or RFC-0007 are
  indicated by the results
- **Recommendation** — proceed, proceed with changes, or reconsider

The combined report is added as an appendix to ADR-0004 before acceptance and
referenced from RFC-0007's Open Questions section.

## Timeline

- **Day 1:** Spike A (SDK maturity)
- **Day 2:** Spike B (contribution model) — reuses Day 1 scaffold where possible
- **Day 3 (optional):** Writeup and ADR/RFC revision

Total: 2-3 days of focused work. Results gate acceptance of ADR-0004 and
implementation start of RFC-0007.

## Success for the Spike Itself

The spike is successful if:
- Both deliverables are completed within the time box, **or**
- A failure signal is surfaced clearly enough to revise the ADR/RFC before
  implementation begins

A "failed" spike that saves the team from building on bad assumptions is a
success. The goal is information, not working code.
