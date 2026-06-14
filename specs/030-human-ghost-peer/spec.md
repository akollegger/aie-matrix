# Feature Specification: Human Participation as Ghost Peer

**Feature Branch**: `030-human-ghost-peer`
**Created**: 2026-06-13
**Status**: Draft
**Input**: User description: "human participation in leaderboards as a peer ghost with human role"

## Proposal Context *(mandatory)*

- **Related Proposal**: Conversation in session — human clients unified with ghost clients; broker challenge UX; leaderboard visibility
- **Scope Boundary**: Treat the Intermedium browser client as a first-class ghost peer: stable identity, guest JWT issuance, unified messaging via `say()`, spawn-grant on first connect, ledger bag, participation in broker challenges, and leaderboard ranking. Proximity guard for directed `say()` is bypassed for the `human` role only.
- **Out of Scope**: Human-initiated contract creation (humans are contractors, not clients for now); human world-position assignment; human-to-human messaging; ghost catalog registration for humans; mobile or native clients.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Join as a named participant (Priority: P1)

A fair attendee opens the Intermedium client in their browser. The client generates a stable identity for them (persisted across page reloads) and silently obtains a guest token. The attendee sees their name and a starting balance of credits in the HUD, confirming they are recognized as a participant — not just a spectator.

**Why this priority**: Everything else depends on stable identity and a valid token. Without this, the attendee cannot send messages, accept challenges, or appear on the leaderboard.

**Independent Test**: Open the client in a fresh browser profile. Verify a ghostId is stored in localStorage, a guest token is obtained, and the HUD shows a name and credit balance. Reload the page and confirm the same ghostId and balance are shown.

**Acceptance Scenarios**:

1. **Given** a first-time visitor, **When** the client loads, **Then** a stable ghostId is generated and persisted in localStorage.
2. **Given** a ghostId in localStorage, **When** the client loads, **Then** a guest JWT is obtained and stored for the session.
3. **Given** a valid guest JWT, **When** the first MCP call is made, **Then** a spawn-grant is applied and the human's bag is seeded with starting credits.
4. **Given** a returning visitor with an existing ghostId, **When** the client loads, **Then** the same ghostId is reused and the spawn-grant is idempotent (no double-grant).

---

### User Story 2 — Talk to a broker NPC (Priority: P2)

The attendee sees ghosts listed in the chat overlay. Broker NPCs are visually distinguished. The attendee selects a broker, reads its offer, and sends "accept" directly. The broker receives the message the same way it would from any ghost — through its inbox — and opens a challenge contract.

**Why this priority**: Broker interaction is the primary gameplay loop. It requires messaging to work (P1) and unlocks earning credits.

**Independent Test**: With P1 working, select a broker in the ghost list, send "accept" in the chat panel. Confirm the broker responds with a question and a contract appears in the UI.

**Acceptance Scenarios**:

1. **Given** the ghost list is visible, **When** the list is rendered, **Then** broker ghosts are visually badged/distinguished from non-broker ghosts.
2. **Given** a broker is selected, **When** the attendee sends a directed message, **Then** it is delivered via the unified `say()` path (no proximity check, role is `human`).
3. **Given** the attendee sends "accept", **When** the broker processes its inbox, **Then** it opens an eval contract with the attendee's ghostId as contractorId.
4. **Given** an open contract, **When** the attendee's client polls for contracts, **Then** the contract and its question are displayed in the UI.

---

### User Story 3 — Complete a broker challenge (Priority: P3)

The attendee sees the question from the broker challenge, types an answer, and submits. The broker evaluates and the attendee receives credits. The attendee's standing appears on the leaderboard.

**Why this priority**: Completing the loop — challenge → answer → reward → leaderboard — is the core experience. Depends on P1 and P2.

**Independent Test**: With an open contract visible, submit an answer. Confirm the contract moves to Settled, the credit balance in the HUD increases, and the attendee's name appears (or rises) on the leaderboard.

**Acceptance Scenarios**:

1. **Given** an open contract with a question, **When** the attendee submits an answer, **Then** the eval contract transitions to Submitted state.
2. **Given** a submitted contract, **When** the broker evaluates (auto-pass), **Then** the contract transitions to Settled and credits are transferred to the attendee's bag.
3. **Given** a settled contract, **When** the HUD is visible, **Then** the attendee's credit balance reflects the earned amount.
4. **Given** a settled contract, **When** the leaderboard is viewed, **Then** the attendee's ghostId (or display name) appears with a score reflecting their earned credits.

---

### User Story 4 — View leaderboard as a participant (Priority: P4)

The attendee can see the leaderboard at any time and identify their own position among all participants (ghosts and humans alike).

**Why this priority**: Leaderboard visibility is a spectator feature that already partially exists; extending it to highlight the human's own entry is a polish step.

**Independent Test**: With credits earned, open the leaderboard panel. Confirm the attendee's entry is present and their row is highlighted or labeled "you".

**Acceptance Scenarios**:

1. **Given** the leaderboard panel is open, **When** the attendee has earned credits, **Then** their ghostId appears in the leaderboard entries.
2. **Given** the leaderboard panel is open, **When** the attendee's entry is visible, **Then** it is visually distinguished (highlighted or labeled) from other entries.

---

### Edge Cases

- What happens if the attendee refreshes mid-challenge? The contract persists server-side; the client should re-fetch open contracts on load and resume the active challenge.
- What happens if the broker has no open slots (max 5 concurrent contracts)? The broker sends a "fully booked" reply and the client displays a friendly message instead of a submit form.
- What happens if the challenge deadline expires before submission? The contract transitions to Expired on next access; the client should show "challenge expired" and clear the form.
- What happens if two browser tabs open with the same ghostId? Both share the same bag and contract state; the spawn-grant is idempotent so no double-seeding occurs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST issue a guest JWT for any provided ghostId without requiring catalog registration or prior agent setup.
- **FR-002**: The client MUST generate a stable ghostId (ULID) on first visit and persist it across page reloads.
- **FR-002a**: The client MUST auto-generate a display name on first visit and allow the attendee to edit it exactly once; after editing it is locked for the session.
- **FR-003**: The client MUST obtain and cache a guest JWT using the stable ghostId before making any authenticated requests.
- **FR-004**: The system MUST recognize `human` as a valid role in the spawn-grant mechanism, seeding the human's bag with starting credits on first authenticated connect.
- **FR-005**: The spawn-grant for a human MUST be idempotent — repeated connects with the same ghostId produce no additional grant.
- **FR-006**: The `say()` operation MUST allow directed messages (with explicit `to` recipient) from callers with the `human` role, even when the caller has no world position.
- **FR-007**: The `say()` operation MUST continue to require a world position for broadcast messages from all callers, including those with the `human` role.
- **FR-008**: The client MUST display broker ghosts with a visual distinction in the ghost list.
- **FR-009**: The client MUST render the active contract inline in the chat panel: the broker's question appears as a broker message, and the chat input is replaced by a submission form while a contract is open. Normal chat input is restored after the contract is settled, expired, or declined.
- **FR-010**: The client MUST display the human's current credit balance in the HUD, updated after each settlement.
- **FR-011**: The leaderboard MUST include human participants alongside ghost participants in its rankings.
- **FR-012**: The leaderboard panel MUST visually distinguish the current human's own entry.

### Key Entities

- **HumanIdentity**: A browser-local record of `{ ghostId, displayName }`. Stable across reloads; ghostId is the ledger actorId and JWT subject.
- **GuestJWT**: A signed token issued by the server carrying `{ sub: ghostId, ghostId, role: "human" }`. Valid for the session duration.
- **ActiveContract**: Client-side view of an open or submitted `EvalContract` where the human is contractorId. Displays question, deadline, and submission form.

### Interface Contracts

- **IC-001**: `POST /auth/guest` — accepts `{ ghostId: string }`, returns `{ token: string }`. The token is a JWT signed with the existing secret, claims `{ sub, ghostId, role: "human" }`. No registration side-effects. No rate limiting — the endpoint is open within the Google IAP-protected perimeter.
- **IC-002**: JWT `role` claim — downstream consumers (ConversationService, spawn-grant seeding) MUST read `role` from JWT claims. The `human` role grants proximity exemption for directed `say()` and triggers the `human` spawn-grant tier.
- **IC-003**: Map gram `:Grants` blocks MUST support a `human` role key, e.g., `[:Grants { human: 3 } | (brokerCredit)]`, parsed identically to existing role keys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An attendee can go from opening the browser to submitting a broker challenge answer in under 3 minutes with no instructions.
- **SC-002**: A returning attendee's identity and balance are restored within 2 seconds of page load, with no repeated prompts.
- **SC-003**: Human participants appear on the leaderboard within 60 seconds of a challenge being settled.
- **SC-004**: Broker NPCs are identifiable in the ghost list without any prior knowledge of the system — visual distinction is self-evident.
- **SC-005**: The spawn-grant is applied exactly once per ghostId per session, verified by the ledger's idempotency key.

## Clarifications

### Session 2026-06-13

- Q: How is the attendee's display name established? → A: Auto-generated at first load, editable once (before or after first interaction).
- Q: Where does the contract UI appear? → A: Inline in the chat panel — question as a broker message, submission form replaces chat input while a contract is active.
- Q: What security posture for POST /auth/guest? → A: Open — no rate limit; the deployed system is protected by Google Identity-Aware Proxy, which is the trust boundary.

## Assumptions

- The Intermedium client is the only human-facing client in scope; no mobile or native app is considered.
- Display names for humans are auto-generated at first load (e.g., via `unique-names-generator`) and can be edited once by the attendee before or after their first interaction. No account system or email required.
- Humans are contractors only; they do not open contracts or act as evaluators in this feature.
- The broker's auto-pass evaluation (`verdict: 1.0`) remains in place — human answers are not manually reviewed.
- The `human` role grant amount is defined in the map gram and managed by the world operator, not hardcoded in server logic.
- Guest JWTs have a fixed TTL (e.g., 24h) matching session duration at the fair; refresh is out of scope.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — add human client as a peer actor type alongside ghosts; document role-based proximity exemption.
- `docs/guides/effect-ts.md` — no change needed.
- `ghosts/npc-agent/catalog/broker.character.gram` — no change needed (role grants are in the map gram).
- Map gram files in `maps/` — must add `human` role to `:Grants` blocks for any session that should grant starting credits to human participants.
- `CLAUDE.md` — add 030 entry to Recent Changes once implemented.
