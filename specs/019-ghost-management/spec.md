# Feature Specification: Admin Ghost Management Panel

**Feature Branch**: `019-ghost-management`
**Created**: 2026-05-23
**Status**: Draft
**Input**: User description: "ghost management as described in @proposals/rfc/0014-admin-ghost-management.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0014](../../proposals/rfc/0014-admin-ghost-management.md) · [ADR-0008](../../proposals/adr/0008-frontend-deployment-access-control.md) · [ADR-0009](../../proposals/adr/0009-first-party-ghost-deployment.md)
- **Scope Boundary**: Three new top-level tabs added to the existing map-editor admin SPA (`tools/map-editor/`): **Sessions** (live world sessions from the world API), **Catalog** (registered ghost agents from the agent-host), and **Ghosts** (active ghost supervision sessions). Together with the existing **Maps** tab, the information architecture follows the natural domain hierarchy: Maps → Sessions → Catalog → Ghosts. The Spawn action lives in the Catalog tab and uses the selected world session to pre-populate the credential.
- **Out of Scope**: Registry integration for obtaining ghost credentials beyond pre-populating worldApiBaseUrl from a selected session (the ghostId and token are still entered manually), polling or real-time updates, multi-agent-host federation, mobile layout, and any changes to the agent-host or world API.
- **Divergence from RFC-0014**: This spec adopts a four-tab information architecture (Maps / Sessions / Catalog / Ghosts) rather than RFC-0014's two-tab layout (Maps / Ghosts with sub-panels). The core API surface and error handling requirements are unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Live World Sessions (Priority: P1)

An operator opens the admin SPA and navigates to the Sessions tab to see which Colyseus world sessions are currently active — which map they are running, how long they have been running, and how many connected players they have. This gives the operator situational awareness before spawning any ghosts.

**Why this priority**: The Sessions tab is the entry point to the operator workflow. An operator needs to know what is running before acting. It also provides the `worldApiBaseUrl` context needed by the Spawn flow, reducing manual credential entry.

**Independent Test**: With the world server running and at least one active Colyseus room, open the admin SPA → Sessions tab. The table lists the active session(s) with map name, start time, and player count. Clicking Reload refreshes the list. This tab delivers operational value on its own with no ghost management needed.

**Acceptance Scenarios**:

1. **Given** one or more world sessions are active, **When** the operator opens the Sessions tab, **Then** a table shows each session with: Session ID, Map name, Status, Start time, Player count.
2. **Given** no world sessions are active, **When** the Sessions tab loads, **Then** an empty-state message "No active world sessions" appears.
3. **Given** the world API is unreachable, **When** the Sessions tab loads, **Then** a banner reads "World API is not reachable — check VITE_API_BASE_URL".
4. **Given** the Sessions table is showing stale data, **When** the operator clicks Reload, **Then** the table refreshes with current session state.

---

### User Story 2 - Browse the Agent Catalog and Spawn a Ghost (Priority: P2)

An operator who has a ghost identity (ghostId + bearer token from `/registry/adopt`) wants to put a ghost into a running world session. They open the Catalog tab, see the available ghost agents, select one, choose a world session from a dropdown (pre-populating the worldApiBaseUrl), enter the ghost ID and token, and click Spawn. The returned session ID confirms the ghost is now active.

**Why this priority**: The Catalog + Spawn flow is the core operator action. Knowing what sessions exist (P1) makes the Spawn form usable with minimal manual input.

**Independent Test**: With agent-host, random-agent, and world server running, open the admin SPA → Catalog tab. The table shows `random-agent-<pod>` with a Wanderer tier badge. Select the agent, choose a running world session from the dropdown, enter a ghostId and token, click Spawn. The panel shows the returned `sessionId`. Testable independently of the Ghosts tab.

**Acceptance Scenarios**:

1. **Given** the agent-host catalog has at least one registered agent, **When** the operator opens the Catalog tab, **Then** a table shows each agent with: Agent ID, Tier badge (Wanderer / Listener / Social), Built-in flag, Base URL, About.
2. **Given** a catalog row is visible, **When** the operator clicks the row, **Then** the full agent card JSON from `GET /v1/catalog/:agentId` expands inline below the row.
3. **Given** the operator selects an agent, **When** they click Spawn, **Then** a spawn form appears with: a dropdown of active world sessions (pre-populates worldApiBaseUrl on selection), a Ghost ID text input, and a credential token text input.
4. **Given** the spawn form is filled with valid inputs, **When** the operator clicks Confirm Spawn, **Then** the returned `sessionId` is displayed inline and the form resets.
5. **Given** the spawn fails (invalid credential, agent not found, etc.), **Then** an inline error appears below the Spawn button without reloading the page.
6. **Given** an agent has no active ghost sessions, **When** the operator clicks Deregister and confirms, **Then** the row is removed from the catalog.
7. **Given** an agent has one or more active ghost sessions, **When** the operator clicks Deregister, **Then** an inline error "Cannot deregister: N active sessions" appears on the row.

---

### User Story 3 - Monitor and Shut Down Ghost Sessions (Priority: P3)

An operator notices a ghost has stopped moving. They open the Ghosts tab, find the session for that ghost, verify its status, and shut it down so a fresh one can be spawned via the Catalog tab.

**Why this priority**: Shutdown closes the operator loop (spawn → observe → shut down). It is less frequent than viewing or spawning but essential for conference-day recovery.

**Independent Test**: With one or more active ghost sessions, open the Ghosts tab. The table lists each session's ID, agent, ghost ID, and status. Clicking Shutdown terminates the session and it disappears after reload. Testable independently.

**Acceptance Scenarios**:

1. **Given** one or more ghost sessions are active, **When** the operator opens the Ghosts tab, **Then** a table shows each session: Session ID, Agent ID, Ghost ID, Status (running / restarting / failed).
2. **Given** a session row is visible, **When** the operator clicks Shutdown, **Then** the session is terminated and the row disappears after the next reload.
3. **Given** a shutdown request fails, **Then** an inline error appears on the row with the failure reason.
4. **Given** no ghost sessions are active, **When** the Ghosts tab loads, **Then** an empty-state message "No active ghost sessions" appears.
5. **Given** the agent-host response includes a `mcpToken` field, **Then** it MUST NOT appear anywhere in the rendered Ghosts tab UI.

---

### Edge Cases

- What happens when the agent-host bearer token is misconfigured? A "401 Unauthorized" banner appears; the token value is never shown in the error.
- What if the world sessions dropdown in the Spawn form is empty (no active sessions)? The dropdown shows "No active sessions" and the Spawn button is disabled until a session is selected or the worldApiBaseUrl is entered manually.
- What if a ghost session's status is an unexpected value? Display the raw string to avoid silently hiding unknown states.
- What if the Spawn form has blank required fields? Each required field shows an inline validation error before the request is sent.
- What if the operator reloads the browser mid-spawn? The in-progress spawn is lost; no partial state is persisted between page loads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The admin SPA MUST provide three new top-level tabs: Sessions, Catalog, and Ghosts, alongside the existing Maps tab.
- **FR-002**: The Sessions tab MUST display active world sessions from the world API in a table: Session ID, Map name, Status, Start time, Player count.
- **FR-003**: The Catalog tab MUST display registered agents from `GET /v1/catalog` in a table: Agent ID, Tier badge, Built-in, Base URL, About.
- **FR-004**: The Catalog tab MUST support row expansion showing the full agent card JSON from `GET /v1/catalog/:agentId`.
- **FR-005**: The Catalog tab MUST provide a Deregister button per row; a 409 response MUST surface as an inline error "Cannot deregister: N active sessions".
- **FR-006**: The Catalog tab MUST provide a Spawn action per agent row that opens a form with: a dropdown of active world sessions (pre-populates `worldApiBaseUrl` on selection), a Ghost ID text input, and a credential token text input.
- **FR-007**: On a successful spawn, the Catalog tab MUST display the returned `sessionId` inline and reset the spawn form.
- **FR-008**: The Ghosts tab MUST display active ghost supervision sessions from `GET /v1/sessions`: Session ID, Agent ID, Ghost ID, Status.
- **FR-009**: The Ghosts tab MUST provide a Shutdown button per row that calls `DELETE /v1/sessions/:sessionId`; the row disappears after the next reload.
- **FR-010**: Each tab MUST have a Reload button that re-fetches only that tab's data.
- **FR-011**: All agent-host requests MUST include `Authorization: Bearer <VITE_AGENT_HOST_BEARER>`.
- **FR-012**: The `mcpToken` field from agent-host session responses MUST NOT be rendered anywhere in the UI.
- **FR-013**: When the agent-host is unreachable, a banner MUST read "Agent host is not reachable — check VITE_AGENT_HOST_URL".
- **FR-014**: When the world API is unreachable, a banner MUST read "World API is not reachable — check VITE_API_BASE_URL".
- **FR-015**: All error states (401, 404, 409, network failure) MUST surface as inline messages without triggering a full page reload.

### Key Entities

- **World Session**: A running Colyseus room instance. Attributes: sessionId, mapName, status, startTime, playerCount, worldApiBaseUrl.
- **Agent (catalog entry)**: A ghost agent registered with the agent-host. Attributes: agentId, baseUrl, tier (Wanderer/Listener/Social), builtIn (bool), about (string), agentCard (full JSON).
- **Ghost Session**: An active supervision session pairing a ghost identity with an agent. Attributes: sessionId, agentId, ghostId, status. The `mcpToken` field is never rendered.
- **Ghost Credential**: The inputs needed to spawn: `ghostId`, `token` (world API bearer), `worldApiBaseUrl` (pre-populated from selected world session).

### Interface Contracts

- **IC-001**: The Sessions tab consumes the world API. The exact endpoint for listing active sessions must be confirmed against the server implementation (likely `GET /sessions` or `GET /rooms`).
- **IC-002**: The Catalog and Ghosts tabs consume the agent-host HTTP API:
  - `GET /v1/catalog` → `{ agents: [{ agentId, baseUrl, tier, builtIn, about }] }`
  - `GET /v1/catalog/:agentId` → full agent card JSON
  - `DELETE /v1/catalog/:agentId` → 204, or 409 `{ error: "ActiveSessionsPreventDeregister", count: N }`
  - `POST /v1/sessions/spawn/:agentId` with `{ ghostId, credential: { token, worldApiBaseUrl } }` → `{ sessionId }`
  - `GET /v1/sessions` → `{ sessions: [{ sessionId, agentId, ghostId, status }] }`
  - `DELETE /v1/sessions/:sessionId` → 204
- **IC-003**: Two new Vite environment variables are required at build time:
  - `VITE_AGENT_HOST_URL` — base URL of the agent-host
  - `VITE_AGENT_HOST_BEARER` — bearer token for agent-host authentication

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can identify a running world session, spawn a ghost into it, observe it in the Ghosts tab, and shut it down in under 5 minutes — with no terminal access or curl commands.
- **SC-002**: All error states are visible inline within 2 seconds of the triggering action.
- **SC-003**: The three new tabs are accessible to any IAP-authenticated operator with no additional login beyond the bearer token baked into the build.
- **SC-004**: Switching between tabs does not lose form state in other tabs or trigger additional API requests.
- **SC-005**: The `mcpToken` credential never appears in any rendered UI element.

## Assumptions

- The world API has an endpoint for listing active Colyseus sessions; the exact path must be confirmed during planning (IC-001).
- The agent-host API endpoints in IC-002 are implemented and match the contract (Spec 009 / 018).
- The admin SPA is already IAP-gated at `admin.matrix.relateby.dev`; this feature adds tabs without changing deployment or IAP config.
- `VITE_AGENT_HOST_BEARER` equals `AGENT_HOST_TOKEN` from `aie-matrix-secrets`.
- Operators obtain `ghostId` and `token` out-of-band via `POST /registry/adopt`; this feature does not automate credential acquisition beyond pre-populating `worldApiBaseUrl` from the selected session.
- Manual reload per tab is sufficient; no polling or websocket subscription needed for the AIEWF 2026 operator team size.

## Documentation Impact *(mandatory)*

- `specs/018-ghost-agent-deployment/quickstart.md` — reference the admin panel as the preferred operator path for spawning ghosts.
- `ghosts/README.md` — note that ghost spawning can be done via the admin panel.
- `deploy/staging/README.md` — add `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER` to the environment variable table.
- `proposals/rfc/0014-admin-ghost-management.md` — note that the implemented IA uses four tabs (Maps / Sessions / Catalog / Ghosts) rather than the two-tab layout described in the RFC.
