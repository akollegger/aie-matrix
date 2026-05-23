# Feature Specification: Admin Ghost Management Panel

**Feature Branch**: `019-ghost-management`
**Created**: 2026-05-23
**Status**: Draft
**Input**: User description: "ghost management as described in @proposals/rfc/0014-admin-ghost-management.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0014](../../proposals/rfc/0014-admin-ghost-management.md) · [ADR-0008](../../proposals/adr/0008-frontend-deployment-access-control.md) · [ADR-0009](../../proposals/adr/0009-first-party-ghost-deployment.md)
- **Scope Boundary**: A second top-level tab ("Ghosts") in the existing map-editor admin SPA (`tools/map-editor/`) with three panels: Catalog (view and deregister agents), Spawn (create a new ghost session), and Sessions (list and shut down active sessions). All agent-host calls are authenticated with a build-time bearer token.
- **Out of Scope**: Registry integration for obtaining ghost credentials (operator pastes token manually), polling or real-time session updates, multi-agent-host federation, mobile layout, and any changes to the agent-host API itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View the Agent Catalog (Priority: P1)

An operator opens the Ghosts tab and immediately sees which ghost agents are registered with the agent-host, their behavioral tier, and whether they are built-in. They can expand any row to inspect the full agent card and can deregister an agent whose container is no longer running.

**Why this priority**: Visibility is the foundation of all other ghost management. Without it, an operator cannot know which agents are available to spawn or whether a deregistration is needed.

**Independent Test**: With agent-host running and `random-agent` registered, open the admin SPA → Ghosts tab. The Catalog panel shows `random-agent-<pod>` with tier badge "Wanderer". Clicking the row reveals the agent card JSON. Clicking Reload refreshes the list. This panel delivers operational value on its own.

**Acceptance Scenarios**:

1. **Given** the agent-host catalog has at least one registered agent, **When** the operator opens the Ghosts tab, **Then** the Catalog panel shows a table row per agent with Agent ID, Tier badge, Built-in flag, Base URL, and About text.
2. **Given** a catalog row is visible, **When** the operator clicks the row, **Then** the full agent card JSON from `GET /v1/catalog/:agentId` expands inline below the row.
3. **Given** an agent has no active sessions, **When** the operator clicks Deregister and confirms, **Then** the row disappears and the panel reflects the updated catalog.
4. **Given** an agent has one or more active sessions, **When** the operator clicks Deregister, **Then** an inline error "Cannot deregister: N active sessions" appears on the row without reloading the page.
5. **Given** the agent-host URL is unreachable, **When** the Catalog panel loads, **Then** a banner reads "Agent host is not reachable — check VITE_AGENT_HOST_URL".
6. **Given** the Catalog panel is showing stale data, **When** the operator clicks Reload, **Then** the table refreshes with the current catalog state.

---

### User Story 2 - Spawn a Ghost Session (Priority: P2)

An operator who has already obtained a ghost credential (ghostId + token + worldApiBaseUrl from `POST /registry/adopt`) wants to start a ghost walking on the map. They pick an agent from the catalog, paste in the credential fields, and click Spawn. The returned session ID confirms the ghost is active.

**Why this priority**: Spawning is the core control action. The Catalog panel (P1) tells the operator what is available; this panel is how they put a ghost into motion.

**Independent Test**: With agent-host and random-agent running and a valid ghost credential obtained via curl, use the Spawn panel to select the agent, enter the credential, and click Spawn. The panel displays the returned `sessionId`. This can be tested independently of the Sessions panel.

**Acceptance Scenarios**:

1. **Given** at least one agent is registered, **When** the operator opens the Spawn panel, **Then** a dropdown lists all agent IDs from the catalog.
2. **Given** the operator has selected an agent, entered a Ghost ID, a credential token, and a worldApiBaseUrl, **When** they click Spawn, **Then** the panel displays the returned `sessionId` inline below the button.
3. **Given** the operator submits a Spawn request with an invalid credential, **When** the agent-host returns an error, **Then** an inline error message below the Spawn button shows the reason without reloading the page.
4. **Given** the operator submits a Spawn request for an agent not found in the catalog, **When** the agent-host returns 404, **Then** the inline error reads "Agent not found".
5. **Given** a successful spawn, **When** the operator navigates to the Sessions panel, **Then** the new session appears in the table.

---

### User Story 3 - Monitor and Shut Down Sessions (Priority: P3)

An operator watching the event floor sees a ghost that has stopped moving. They open the Sessions panel to verify the session is still alive, and if it appears stuck, they shut it down so a new one can be spawned.

**Why this priority**: Session lifecycle control (P3) is the last step in the operator loop: spawn → observe → shut down. It is less frequently needed than viewing or spawning but closes the control loop.

**Independent Test**: With one or more active sessions running, open the Sessions panel. The table shows sessionId, agentId, ghostId, and status for each. Clicking Shutdown on a row removes it after reload. This panel can be demonstrated independently.

**Acceptance Scenarios**:

1. **Given** one or more ghost sessions are active, **When** the operator opens the Sessions panel, **Then** a table shows Session ID, Agent ID, Ghost ID, and Status (running / restarting / failed) for each session.
2. **Given** a session row is visible, **When** the operator clicks Shutdown, **Then** the session is terminated and the row disappears after the next reload.
3. **Given** a shutdown request fails, **Then** an inline error appears on the row with the failure reason.
4. **Given** no sessions are active, **When** the Sessions panel loads, **Then** the table shows an empty-state message ("No active sessions").
5. **Given** the mcpToken field is present in the agent-host response, **Then** it MUST NOT be rendered anywhere in the Sessions panel UI.

---

### Edge Cases

- What happens when the agent-host bearer token is misconfigured? The panel should show a "401 Unauthorized" banner and not expose the token value in the error message.
- What happens when the catalog is empty? The Catalog panel shows an empty-state message and the Spawn dropdown is disabled with a tooltip "No agents registered".
- What if a session's status is unknown (not running/restarting/failed)? Display the raw status string to avoid silently hiding unexpected states.
- What if the Spawn form is submitted with blank required fields? Each required field shows a validation error inline before the request is sent.
- What if the operator reloads the page mid-spawn? The in-progress spawn is lost; no partial state is persisted between page loads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The admin SPA MUST provide a "Ghosts" top-level tab alongside the existing "Maps" tab.
- **FR-002**: The Ghosts tab MUST contain three panels in vertical order: Catalog, Spawn, Sessions.
- **FR-003**: The Catalog panel MUST display all registered agents from `GET /v1/catalog` in a table with columns: Agent ID, Tier (badge), Built-in, Base URL, About.
- **FR-004**: The Catalog panel MUST support row expansion to show the full agent card JSON from `GET /v1/catalog/:agentId`.
- **FR-005**: The Catalog panel MUST provide a Deregister button per row that calls `DELETE /v1/catalog/:agentId` after confirmation; a 409 response MUST surface as an inline error "Cannot deregister: N active sessions".
- **FR-006**: The Spawn panel MUST provide a dropdown of registered agent IDs (populated from `GET /v1/catalog`), text inputs for Ghost ID, credential token, and worldApiBaseUrl, and a Spawn button.
- **FR-007**: On a successful spawn, the Spawn panel MUST display the returned `sessionId` inline.
- **FR-008**: The Sessions panel MUST display all active sessions from `GET /v1/sessions` with columns: Session ID, Agent ID, Ghost ID, Status.
- **FR-009**: The Sessions panel MUST provide a Shutdown button per row that calls `DELETE /v1/sessions/:sessionId`; the row MUST be removed from view after the next reload.
- **FR-010**: Each panel MUST have an independent Reload button that re-fetches only that panel's data.
- **FR-011**: All agent-host requests MUST include `Authorization: Bearer <VITE_AGENT_HOST_BEARER>` in the request header.
- **FR-012**: The `mcpToken` field from session responses MUST NOT be rendered in any panel UI.
- **FR-013**: When the agent-host is unreachable, a banner MUST appear: "Agent host is not reachable — check VITE_AGENT_HOST_URL".
- **FR-014**: All error states (401, 404, 409, network failure) MUST surface as inline messages without triggering a full page reload.

### Key Entities

- **Agent (catalog entry)**: A ghost agent registered with the agent-host. Attributes: agentId, baseUrl, tier (Wanderer/Listener/Social), builtIn (bool), about (string), agentCard (full JSON object).
- **Ghost Session**: An active supervision session pairing a ghost identity with an agent. Attributes: sessionId, agentId, ghostId, status. The `mcpToken` field exists in the API response but is never rendered.
- **Ghost Credential**: The pair of inputs needed to spawn a session: `token` (world API bearer token from `/registry/adopt`) and `worldApiBaseUrl`.

### Interface Contracts

- **IC-001**: The admin SPA consumes the agent-host HTTP API. All endpoints must match the contract defined in the agent-host implementation:
  - `GET /v1/catalog` → `{ agents: [{ agentId, baseUrl, tier, builtIn, about }] }`
  - `GET /v1/catalog/:agentId` → full agent card JSON
  - `DELETE /v1/catalog/:agentId` → 204 on success, 409 with `{ error: "ActiveSessionsPreventDeregister", count: N }` if sessions exist
  - `POST /v1/sessions/spawn/:agentId` with `{ ghostId, credential: { token, worldApiBaseUrl } }` → `{ sessionId }`
  - `GET /v1/sessions` → `{ sessions: [{ sessionId, agentId, ghostId, status }] }`
  - `DELETE /v1/sessions/:sessionId` → 204 on success
- **IC-002**: Two new Vite environment variables are required at build time:
  - `VITE_AGENT_HOST_URL` — base URL of the agent-host (e.g., `http://localhost:4000`)
  - `VITE_AGENT_HOST_BEARER` — bearer token for agent-host authentication

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can view the agent catalog, spawn a ghost session, observe it in the Sessions panel, and shut it down in under 5 minutes — with no terminal access or curl commands.
- **SC-002**: All error states (unreachable agent-host, blocked deregister, failed spawn, failed shutdown) are visible inline on the relevant panel within 2 seconds of the triggering action.
- **SC-003**: The Ghosts tab is accessible to any IAP-authenticated operator; no additional login or secret entry is required beyond the bearer token baked into the admin build.
- **SC-004**: Switching between the Maps tab and the Ghosts tab does not lose form state or trigger additional API requests.
- **SC-005**: The mcpToken credential never appears in the rendered UI or browser developer tools network response display (it may appear in the raw network response, which is acceptable).

## Assumptions

- The agent-host API endpoints defined in IC-001 are already implemented and match the contract (implemented in Spec 009 / 018).
- The admin SPA (`tools/map-editor/`) is already deployed to `admin.matrix.relateby.dev` and IAP-gated per ADR-0008; this feature adds a tab without changing the deployment or IAP configuration.
- `VITE_AGENT_HOST_URL` for production will be set to the agent-host's internal cluster URL via port-forward or a future ingress (per the open question in RFC-0014); for now, the value is configured at build time.
- `VITE_AGENT_HOST_BEARER` is the same token as `AGENT_HOST_TOKEN` in `aie-matrix-secrets` (renamed from `GHOST_HOUSE_DEV_TOKEN` in Spec 018).
- Operators obtaining ghost credentials (`ghostId`, `token`, `worldApiBaseUrl`) do so out-of-band via `POST /registry/adopt`; this feature does not automate credential acquisition.
- No polling or websocket subscription is required for the initial implementation; manual reload per panel is sufficient for the operator team size at AIEWF 2026.
- The admin SPA uses React + Vite (existing stack); no new frameworks are introduced.

## Documentation Impact *(mandatory)*

- `specs/018-ghost-agent-deployment/quickstart.md` — the curl-based spawn walkthrough remains valid but should reference the admin panel as the preferred operator path once this feature ships.
- `ghosts/README.md` — add a note that ghost spawning can be done via the admin panel (link to this spec).
- `deploy/staging/README.md` — add `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER` to the environment variable reference table.
