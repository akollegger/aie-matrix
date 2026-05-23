# Research: Admin Ghost Management Panel

## Decision 1 — Interaction pattern: Miller columns (progressive disclosure) over tabs

**Decision**: The admin sidebar uses a Miller columns pattern. Clicking a session opens a Catalog panel to its right; clicking an agent opens a Ghost List panel further right. Each panel has an X button and Esc closes/goes up one level. The entire left admin area is an overlay over the map editor.

**Rationale**: Stakeholder review identified that Maps → Sessions → Catalog → Ghosts is the natural domain hierarchy. Tabs flatten this into unrelated peers and lose the navigational context (e.g., "which session am I spawning into?"). The existing `AdminPanel.tsx` already uses a disclosure-triangle pattern for sessions under maps; Miller columns extends that spatial metaphor.

**Alternatives considered**: Four top-level tabs (initial RFC-0014 design) — rejected because it breaks the contextual relationship between session selection and spawn action.

---

## Decision 2 — Spawn flow: one-click, fully automated credential acquisition

**Decision**: Clicking "Spawn Ghost" requires no operator input. The admin client calls three registry endpoints automatically:
1. `POST /registry/houses` with `displayName: agentId` → `agentHostId`
2. `POST /registry/caretakers` with auto-generated label → `caretakerId`
3. `POST /registry/adopt` with both IDs → `{ ghostId, credential }`
4. `POST /v1/sessions/spawn/:agentId` with credential → `{ sessionId }`

All three registry endpoints are open (no authentication required). The `worldApiBaseUrl` is derived from the session already selected in the drill-down — no operator input needed.

**Rationale**: The operator already has all the context needed from the drill-down navigation (which session, which agent). Asking them to manually obtain and paste a bearer token from a separate curl command is unnecessary friction.

**Constraint discovered**: The registry enforces one ghost per caretaker (`CARETAKER_ALREADY_HAS_GHOST` error). Each spawn creates a fresh caretaker with a unique name — no reuse across spawns.

**Alternatives considered**: Manual token paste form (RFC-0014 original) — rejected once registry APIs confirmed open and callable from the browser.

---

## Decision 3 — Ghost name generation: `unique-names-generator`

**Decision**: Use `unique-names-generator` npm package with the built-in `adjectives + colors + animals` dictionaries to auto-generate the caretaker label on each spawn (e.g., "fluffy-teal-mongoose"). No custom word list needed for the initial implementation.

**Rationale**: Well-maintained (~2M downloads/week), zero transitive dependencies, produces memorable three-word names, trivially tree-shaken by Vite. The thematic ghost/hex vocabulary can be added later via custom dictionaries if desired.

**Alternatives considered**: Custom word lists (thematic but more work), `petname` (two words only), `human-id` (less funny).

---

## Decision 4 — Detail panel placement

**Decision**: Add a `DetailPanel` component as a new right-side overlay that appears when an admin item (session, agent, or ghost) is selected. The existing map edit sidebar (LayerPanel, PropertyEditor, etc.) remains unchanged for edit mode. The two right panels are mutually exclusive: edit tools show in edit mode, `DetailPanel` shows when the admin sidebar has a selection.

**Rationale**: Minimises risk to the existing edit sidebar. The `App.tsx` already manages an `edit/admin` mode toggle with two separate overlay panels; extending this pattern is the smallest change.

**Alternatives considered**: Unified right panel that adapts to both edit and admin context — deferred; requires restructuring `App.tsx` state and the edit sidebar internals.

---

## Decision 5 — AdminPanel refactor approach

**Decision**: Extract the Miller column panels as separate components (`CatalogPanel.tsx`, `GhostListPanel.tsx`) under `panels/admin/`. Add a `useAdminSelection` hook to share selected session/agent/ghost state between `AdminPanel` and `DetailPanel`. Keep `AdminPanel.tsx` as the orchestrator.

**Rationale**: The existing 540-line monolith is maintainable but not extensible to three levels of drill-down without clear component boundaries. Extracting panels avoids the component growing to 1000+ lines and makes each level independently testable.

**Confirmed**: `GET /live?status=active` is already called in `AdminPanel.tsx` via `services/mapServer.ts`. No new session-listing code needed — only the click handler to open `CatalogPanel`.

---

## Decision 6 — Sessions endpoint (IC-001 resolved)

**Decision**: `GET /live?status=active` at `VITE_API_BASE_URL/live`. Response: array of `SessionRecord` with `{ id, name, status, startedAt, world, maps }`.

The `worldApiBaseUrl` for the spawn credential is derived as `VITE_API_BASE_URL` (the same server that owns the session). There is no per-session `worldApiBaseUrl` field in the response — it is a global configuration value.

**Rationale**: Confirmed by reading `server/world-api/src/live/LiveSessionRoutes.ts` and `LiveSessionService.ts`.

---

## Decision 7 — New environment variables

Two new Vite build-time variables added to `tools/map-editor/.env.example` and the CI workflow:

| Variable | Purpose |
|---|---|
| `VITE_AGENT_HOST_URL` | Base URL of the agent-host (e.g., `http://localhost:4000`) |
| `VITE_AGENT_HOST_BEARER` | Bearer token for agent-host — same value as `AGENT_HOST_TOKEN` in `aie-matrix-secrets` |

The `worldApiBaseUrl` used in the spawn credential is `VITE_API_BASE_URL` (already present).
