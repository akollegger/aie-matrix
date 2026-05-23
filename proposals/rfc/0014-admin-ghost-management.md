# RFC-0014: Admin Ghost Management Panel

**Status:** accepted  
**Date:** 2026-05-22  
**Authors:** @akollegger  
**Related:** [ADR-0008](../adr/0008-frontend-deployment-access-control.md) · [ADR-0009](../adr/0009-first-party-ghost-deployment.md) · [RFC-0013](0013-map-management.md) · [Spec 018](../../specs/018-ghost-agent-deployment/spec.md) · [Spec 019](../../specs/019-ghost-management/spec.md)

> **Implementation note (Spec 019)**: The implemented information architecture uses a **Miller columns / progressive disclosure** pattern (Maps → Sessions → Catalog → Ghosts) rather than the two-tab layout described in this RFC. The core API surface and error handling requirements are unchanged. One-click spawn was also implemented (the admin panel acquires ghost credentials from the registry automatically — no manual token entry). See `specs/019-ghost-management/research.md` for the decision rationale.

## Summary

Extend the admin client (the IAP-gated SPA hosted at `admin.matrix.relateby.dev`) with a Ghost Management panel that gives operators in-browser control over the agent-host: browsing the registered agent catalog, spawning ghost sessions for a given ghost identity, monitoring active sessions, and shutting sessions down. These controls are the operational complement to the ghost deployment infrastructure introduced in ADR-0009 and Spec 018 — once first-party ghost agents are running, operators need visibility and control without resorting to raw `curl` commands.

## Motivation

After Spec 018 is implemented, ghost agents (`random-agent`, future first-party agents) will self-register with the agent-host catalog on startup and run as Kubernetes Deployments. The agent-host already exposes the necessary HTTP endpoints (`/v1/catalog`, `/v1/sessions`). What is missing is an operator-friendly surface for:

**Visibility** — "What agents are registered? What tier are they? How many sessions are active?"  
**Control** — "Spawn a ghost for this identity. Shut down this session. Deregister an agent whose container is gone."  
**Diagnosis** — "That ghost stopped moving — is its session still alive? Did the agent-host lose the A2A connection?"

Today, operators interact with the agent-host exclusively via the CLI and documented `curl` sequences in `specs/009-ghost-house-a2a/quickstart.md`. This is acceptable during development but not at conference time when a non-technical operator needs to manage 50+ ghost sessions from the operations room.

The admin client already handles map lifecycle (RFC-0013). Adding a Ghost Management panel to the same IAP-gated SPA keeps the operator workflow in one browser tab and reuses the authentication already established by ADR-0008.

## Acceptance Criteria

Prerequisites: local stack running (world-api, agent-host, `random-agent` registered and spawned), admin SPA running with `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER` set.

1. Open the admin SPA and navigate to the **Ghosts** tab. The **Catalog** panel shows `random-agent` with tier badge "Wanderer".
2. Click the `random-agent` row — the full agent card JSON expands inline.
3. In the **Sessions** panel, the active session appears with status "running".
4. In the **Spawn** panel, select `random-agent`, enter a ghost ID and credential, click **Spawn** — the returned `sessionId` is displayed and the session appears in the Sessions panel after reload.
5. Click **Shutdown** on that session — the row disappears after reload.
6. Click **Deregister** on `random-agent` while a session is active — an inline error "Cannot deregister: 1 active sessions" appears without reloading the page.

Expected time to verify: ~10 minutes with a running local stack.

## Design

### Structure: new tab in the existing admin SPA

The admin client is `tools/map-editor/` — the React + Vite SPA deployed to the admin GCS bucket per ADR-0008. It gains a second top-level tab: **Ghosts**, alongside the existing **Maps** tab. The two tabs are independent — switching tabs does not reload agent-host or world-api state.

```
┌─────────────────────────────────────────────────┐
│  aie-matrix admin            [Maps] [Ghosts]    │
│─────────────────────────────────────────────────│
│  (active tab content)                           │
└─────────────────────────────────────────────────┘
```

The Ghosts tab has three panels displayed in a vertical layout: **Catalog**, **Spawn**, and **Sessions**. Panels refresh on demand (a reload button per panel); no polling or websocket subscription in the initial implementation.

---

### Panel: Catalog

Displays all agents currently registered in the agent-host catalog.

**Data source:** `GET /v1/catalog` → `{ agents: [{ agentId, baseUrl, tier, builtIn, about }] }`

**UI:**
- Table with columns: Agent ID, Tier (badge: Wanderer / Listener / Social), Built-in (yes/no), Base URL, About.
- Each row has a **Deregister** button that calls `DELETE /v1/catalog/:agentId` after a confirmation prompt. The button is disabled if the agent has active sessions (the endpoint returns 409 with `ActiveSessionsPreventDeregister`; surface as an inline error).
- Clicking a row expands to show the full agent card JSON (fetched from `GET /v1/catalog/:agentId`).
- A **Reload** button at the top of the panel refreshes the list.

---

### Panel: Spawn

Lets an operator manually spawn a ghost session for a given ghost identity using a registered agent.

**Data source:** `POST /v1/sessions/spawn/:agentId` with body `{ ghostId, credential: { token, worldApiBaseUrl } }`

**UI:**
- Dropdown to select an agent from the catalog (populated from `GET /v1/catalog`).
- Text input for Ghost ID (the H3 identity string or attendee identifier).
- Text inputs for World Credential: `token` (the ghost's MCP bearer token, obtained from the registry) and `worldApiBaseUrl`.
- **Spawn** button: submits the request, shows the returned `sessionId` on success, or an inline error on failure.

**Note:** The credential inputs mean this panel is only usable by operators who have the ghost's MCP token. This is appropriate — unauthorized spawning is prevented at the agent-host level by `requireBearer` middleware. For conference operations, the token is obtained from the registry service (`/registry/adopt`), which the operator has already completed when adopting the ghost.

---

### Panel: Sessions

Lists all currently active supervision sessions managed by the agent-host.

**Data source:** `GET /v1/sessions` → `{ sessions: [{ sessionId, agentId, ghostId, status }] }` — display these four fields only. The `mcpToken` field returned by the supervisor MUST NOT be rendered in the UI.

**UI:**
- Table with columns: Session ID, Agent ID, Ghost ID, Status (running / restarting / failed).
- Each row has a **Shutdown** button that calls `DELETE /v1/sessions/:sessionId`.
- A **Reload** button refreshes the list.

---

### Configuration

The admin SPA already reads `VITE_WORLD_API_URL` and `VITE_MAP_API_BASE_URL` from its Vite env. Two new env vars are added:

| Variable | Purpose |
|---|---|
| `VITE_AGENT_HOST_URL` | Base URL for the agent-host (e.g. `http://localhost:4000` locally, the cluster service URL in staging) |
| `VITE_AGENT_HOST_BEARER` | Bearer token for agent-host authenticated calls — same value as `GHOST_HOUSE_DEV_TOKEN` in current env files; will be `AGENT_HOST_TOKEN` after the pending rename |

These are injected at build time for GCS deployment (per ADR-0008's static build pattern) and via `.env.local` for local development.

All agent-host requests from the admin client send `Authorization: Bearer $VITE_AGENT_HOST_BEARER`.

---

### Error handling

| Scenario | UX |
|---|---|
| Agent-host unreachable | Banner: "Agent host is not reachable — check `VITE_AGENT_HOST_URL`" |
| Deregister blocked by active sessions | Inline error on the row: "Cannot deregister: N active sessions" |
| Spawn fails (agent not found, credential invalid) | Inline error below the Spawn button with the error message |
| Session shutdown fails | Inline error on the row |

No global error boundary beyond the existing admin SPA's error handling.

---

### Delivery

All three panels (Catalog, Spawn, Sessions) ship together. The Spawn panel accepts a manually-entered ghost credential (token + worldApiBaseUrl) — no registry integration required. This covers the full operator workflow in a single release.

## Open Questions

No unresolved questions for the initial staging release. The four questions below were considered and resolved with simple staging-appropriate answers:

**Credential sourcing for spawn** — The Spawn panel requires the ghost's MCP bearer token from the registry. For staging, the operator pastes the token manually (obtained from `POST /registry/adopt` via curl). No registry integration in the SPA. This is acceptable for a small operator team; revisit if conference operations require a self-serve flow.

**Agent-host URL reachability** — For staging, `VITE_AGENT_HOST_URL` is set to the agent-host's direct URL (external IP or port-forward). No special load-balancer routing is needed. The admin SPA is IAP-gated, so the operator's browser is always a trusted origin. Revisit only if the agent-host must be cluster-internal with no public exposure.

**Polling vs. push** — Manual refresh only. A reload button per panel is sufficient for a staging operator team. No polling added.

**Multi-replica sessions** — Single agent-host replica for staging. The in-memory session limitation is not a concern at this scale. If replicas are added later, the operator runbook will note that `GET /v1/sessions` reflects one replica's view.

## Alternatives

**Separate admin SPA for ghost management.** A dedicated admin app at `agents.admin.matrix.relateby.dev` would isolate the ghost management UI from the map editor. The cost: a second IAP-gated bucket to configure, a second build pipeline, and split operational attention. The benefit (independent deployment, no shared state) does not outweigh the overhead for an initial operator-facing tool at this scale.

**CLI / curl-based operator workflow.** The existing `quickstart.md` documents all the `curl` commands operators need. This requires terminal access and knowledge of the API — acceptable during development, not at a live conference where a non-technical operations room person may need to restart a ghost session quickly. The admin panel reduces operational risk at the event.

**Server-side rendered admin (SSR).** An Express or h3 server rendering the admin UI server-side would simplify the credential model (no VITE_AGENT_HOST_BEARER baked into the build). The overhead of adding a new server service is not justified; the static SPA model from ADR-0008 is already established and the bearer token exposure within the IAP-gated context is acceptable.
