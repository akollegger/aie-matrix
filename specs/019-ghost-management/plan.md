# Implementation Plan: Admin Ghost Management Panel

**Branch**: `019-ghost-management` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/019-ghost-management/spec.md`

## Summary

Extend the map-editor admin SPA with a Miller columns drill-down for ghost lifecycle management. Clicking a map's session opens an agent catalog panel; clicking an agent opens a ghost session panel; clicking "Spawn Ghost" automatically acquires registry credentials and spawns the ghost in one step. An operator can spawn, monitor, and shut down ghost sessions without any terminal access.

The left admin sidebar is already an overlay over the map editor (`AdminPanel.tsx`). This plan extends it with two new column panels and adds a right-side detail panel.

## Technical Context

**Language/Version**: TypeScript 5.7 (browser target, ESM) / React 18 / Vite 6  
**Primary Dependencies**: React 18, Vite 6, `unique-names-generator` (new), existing `mapServer.ts` service pattern  
**Storage**: Browser memory only — no persistence across page loads  
**Testing**: Manual smoke tests per quickstart.md (no automated UI tests planned for this feature)  
**Target Platform**: Browser (GCS static hosting, IAP-gated at admin.matrix.relateby.dev)  
**Project Type**: Web SPA feature extension  
**Performance Goals**: Each panel renders in < 300ms; spawn completes in < 10s (registry RTT + agent spawn)  
**Constraints**: `mcpToken` MUST never appear in any rendered DOM element; all errors are inline (no page reload); manual reload per panel (no polling)  
**Scale/Scope**: Single admin user at a time; up to ~10 agents and ~20 ghost sessions during AIEWF 2026

## Constitution Check

- ✅ Proposal linkage: RFC-0014, ADR-0008, ADR-0009 all identified; scope matches planned work
- ✅ Architectural boundary preserved: Changes are limited to `tools/map-editor/` — no server changes
- ✅ Interface contracts documented under `specs/019-ghost-management/contracts/`
- ✅ Verification: Smoke tests in `quickstart.md` cover each user story independently
- ✅ Documentation impact enumerated (see spec.md § Documentation Impact)

## Project Structure

### Documentation (this feature)

```text
specs/019-ghost-management/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output (7 decisions)
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ic-agenthost-api.md    # Agent-host REST client contract
│   └── ic-registry-spawn.md  # Registry + spawn orchestration contract
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code

```text
tools/map-editor/
├── .env.example                          # Add VITE_AGENT_HOST_URL, VITE_AGENT_HOST_BEARER
├── package.json                          # Add unique-names-generator
└── src/
    ├── App.tsx                           # Add DetailPanel overlay; remove mode toggle bar (always admin)
    ├── hooks/
    │   └── useAdminSelection.ts          # NEW: shared selection state hook
    ├── services/
    │   ├── mapServer.ts                  # Unchanged (already has listSessions)
    │   ├── agentHostClient.ts            # NEW: agent-host API wrapper
    │   └── registryClient.ts             # NEW: one-click spawn orchestration
    └── panels/
        ├── AdminPanel.tsx                # Extend with session click → CatalogPanel
        ├── admin/
        │   ├── CatalogPanel.tsx          # NEW: agent catalog + spawn action
        │   └── GhostListPanel.tsx        # NEW: ghost session list + shutdown
        └── detail/
            └── DetailPanel.tsx           # NEW: right-side detail overlay
```

**Structure Decision**: Adding `panels/admin/` and `panels/detail/` subdirectories to keep new components separate from the existing flat panel list. The `hooks/` directory is new at `src/` level following React project conventions.

## Implementation Phases

### Phase 0: Setup

1. Add `unique-names-generator` to `tools/map-editor/package.json`:
   ```bash
   cd tools/map-editor && pnpm add unique-names-generator
   ```

2. Add new env vars to `tools/map-editor/.env.example`:
   ```env
   VITE_AGENT_HOST_URL=http://localhost:4000
   VITE_AGENT_HOST_BEARER=
   ```

3. Create directory structure:
   ```bash
   mkdir -p tools/map-editor/src/panels/admin
   mkdir -p tools/map-editor/src/panels/detail
   mkdir -p tools/map-editor/src/hooks
   ```

### Phase 1: New Service Modules

#### `tools/map-editor/src/services/agentHostClient.ts`

Wraps all `VITE_AGENT_HOST_URL` calls. Auth: `Authorization: Bearer <VITE_AGENT_HOST_BEARER>`.

```ts
const agentHostUrl = (import.meta.env.VITE_AGENT_HOST_URL ?? "http://localhost:4000").replace(/\/$/, "")
const agentHostBearer = import.meta.env.VITE_AGENT_HOST_BEARER ?? ""

const authHeaders = () => ({
  "Authorization": `Bearer ${agentHostBearer}`,
  "Content-Type": "application/json",
})

export interface AgentCatalogEntry {
  agentId: string
  baseUrl: string
  builtIn: boolean
  registeredAt: string
  tier: "wanderer" | "listener" | "social"
  about: string
  agentCard: unknown
}

export interface GhostSessionRecord {
  sessionId: string
  agentId: string
  ghostId: string
  status: string
}

// Transform raw catalog response — extract tier and about from agentCard
export async function listAgents(): Promise<AgentCatalogEntry[]>

export async function getAgentCard(agentId: string): Promise<unknown>

export async function deregisterAgent(agentId: string): Promise<void>
// throws { status: 409, count: N } for ActiveSessionsPreventDeregister

export async function listGhostSessions(): Promise<GhostSessionRecord[]>
// strips mcpToken before returning

export async function spawnGhost(
  agentId: string,
  ghostId: string,
  credential: { token: string; worldApiBaseUrl: string }
): Promise<{ sessionId: string }>
// strips mcpToken from response

export async function shutdownGhostSession(sessionId: string): Promise<void>
```

**Error class**:
```ts
export class AgentHostError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
```

Network failures (non-HTTP) are caught and rethrown as `AgentHostError(-1, "Agent host is not reachable...")`.

#### `tools/map-editor/src/services/registryClient.ts`

```ts
import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator"
import { spawnGhost } from "./agentHostClient"

const worldApiUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "")

export async function oneClickSpawn(agentId: string): Promise<{ sessionId: string; ghostId: string }>
```

Internally: Step 1 → houses, Step 2 → caretakers (unique name), Step 3 → adopt, Step 4 → spawnGhost. See `contracts/ic-registry-spawn.md` for full flow.

### Phase 2: Selection State Hook

#### `tools/map-editor/src/hooks/useAdminSelection.ts`

```ts
export interface AdminSelection {
  selectedSessionId: string | null
  selectedAgentId: string | null
  selectedGhostSessionId: string | null
}

// Returns state + setters; closing a panel at level N also clears level N+1
export function useAdminSelection(): {
  selection: AdminSelection
  selectSession: (id: string | null) => void
  selectAgent: (id: string | null) => void
  selectGhostSession: (id: string | null) => void
}
```

State transitions:
- `selectSession(id)` → sets `selectedSessionId`, clears `selectedAgentId` and `selectedGhostSessionId`
- `selectAgent(id)` → sets `selectedAgentId`, clears `selectedGhostSessionId`
- `selectSession(null)` → closes CatalogPanel (and GhostListPanel if open)
- `selectAgent(null)` → closes GhostListPanel only

### Phase 3: New Panel Components

#### `tools/map-editor/src/panels/admin/CatalogPanel.tsx`

Props: `{ sessionId: string; onSelectAgent: (id: string | null) => void; selectedAgentId: string | null; onClose: () => void }`

Responsibilities:
- On mount: `listAgents()` → display table
- Table columns: Agent ID, Tier badge (color-coded), Built-in flag, About
- Row click: expand inline agent card JSON + show Spawn Ghost button
- **Spawn Ghost button**: calls `oneClickSpawn(agentId)` → shows sessionId on success, inline error on failure
- Row hover: show **Deregister** button → calls `deregisterAgent(agentId)` → inline "Cannot deregister: N active sessions" on 409
- Header: "Catalog" + ↻ reload + ✕ close button
- Empty state: "No agents registered"
- Error banner: "Agent host is not reachable — check VITE_AGENT_HOST_URL"

Tier badge colors (matching existing `actionBtn` style palette):
- `wanderer` → amber/orange (`#cc8833` background)
- `listener` → blue (`#2255aa`)
- `social` → green (`#225522`)

#### `tools/map-editor/src/panels/admin/GhostListPanel.tsx`

Props: `{ agentId: string; onSelectGhostSession: (id: string | null) => void; selectedGhostSessionId: string | null; onClose: () => void }`

Responsibilities:
- On mount: `listGhostSessions()` filtered to `agentId`
- Table columns: Session ID (truncated), Ghost ID, Status
- Status display: known statuses styled; unknown statuses displayed as raw string (FR-015)
- Row: **Shutdown** button → `shutdownGhostSession(sessionId)` → row disappears on next reload
- Header: "Ghosts — {agentId}" + ↻ reload + ✕ close button
- Empty state: "No active ghost sessions"
- `mcpToken` MUST NOT appear anywhere in this component

#### `tools/map-editor/src/panels/detail/DetailPanel.tsx`

Props: `{ selection: AdminSelection }`

Responsibilities:
- Shown in the right overlay when in admin mode (replaces the edit sidebar)
- At cold start with no selection: shows "Select a map, session, or agent to see details"
- With `selectedGhostSessionId`: shows ghost session details (sessionId, agentId, ghostId, status)
- Styled to match the existing right overlay (280px wide, `#16162a` background)

### Phase 4: Extend AdminPanel.tsx

Changes to `tools/map-editor/src/panels/AdminPanel.tsx`:

1. Accept `useAdminSelection` state via props or internal hook
2. **Session click handler**: clicking a session row calls `selectSession(session.id)` — opens CatalogPanel
3. Visual affordance: selected session row gets a highlight border; ▶ indicator to show CatalogPanel is open
4. Remove the session sub-rows' "End" shortcut from the map list if CatalogPanel now owns that action (TBD — keep for now to avoid breaking existing flow)
5. The CatalogPanel and GhostListPanel are rendered adjacent to AdminPanel in the left overlay stack (horizontal Miller columns)

### Phase 5: Update App.tsx

Changes to `tools/map-editor/src/App.tsx`:

1. Instantiate `useAdminSelection()` at App level
2. In admin mode: render the left overlay as `[AdminPanel | CatalogPanel? | GhostListPanel?]` in a horizontal flex
3. In admin mode: render `DetailPanel` in the right overlay (replaces edit sidebar)
4. In edit mode: left and right overlays unchanged (edit sidebar on right, no admin panels)
5. Keep the Edit/Admin mode toggle bar (it serves as the entry point to admin mode)

```tsx
// Admin left overlay — Miller columns
{mode === "admin" && (
  <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, display: "flex", zIndex: 10 }}>
    <AdminPanel selection={selection} onSelectSession={selectSession} />
    {selection.selectedSessionId && (
      <CatalogPanel
        sessionId={selection.selectedSessionId}
        onSelectAgent={selectAgent}
        selectedAgentId={selection.selectedAgentId}
        onClose={() => selectSession(null)}
      />
    )}
    {selection.selectedAgentId && (
      <GhostListPanel
        agentId={selection.selectedAgentId}
        onSelectGhostSession={selectGhostSession}
        selectedGhostSessionId={selection.selectedGhostSessionId}
        onClose={() => selectAgent(null)}
      />
    )}
  </div>
)}
```

### Phase 6: Env Var Wiring

1. **`tools/map-editor/.env.example`**: Add `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER`
2. **CI workflow** (`.github/workflows/production-deploy.yml`): Add the two new vars to the map-editor build step, sourced from GCP secrets
3. **`deploy/staging/README.md`**: Add both variables to the environment variable table
4. **`specs/019-ghost-management/quickstart.md`**: Already documents local `.env.local` setup

### Phase 7: Keyboard / Accessibility

- ✕ button on each panel closes it (calls `onClose` prop)
- Esc on `CatalogPanel` → calls `onClose` (via `useEffect` + `keydown` listener scoped to that panel)
- Esc on `GhostListPanel` → same
- Focus management: when a panel opens, its first interactive element receives focus

## Complexity Tracking

No Constitution violations. All changes are scoped to `tools/map-editor/`. No new server-side code. No new packages beyond `unique-names-generator` (zero transitive deps, 2M downloads/week).

## Dependency Graph

```
Phase 0 (Setup)
  ↓
Phase 1 (Services: agentHostClient.ts, registryClient.ts)
  ↓
Phase 2 (Hook: useAdminSelection)
  ↓
Phase 3 (Panels: CatalogPanel, GhostListPanel, DetailPanel)
  ↓
Phase 4 (Extend AdminPanel)
  ↓
Phase 5 (Update App.tsx)
  ↓
Phase 6 (Env var wiring)
  ↓
Phase 7 (Keyboard / A11y polish)
```

Phases 1 and 2 can proceed in parallel once Phase 0 is complete.  
Phases 3, 4, 5 depend on Phases 1 and 2.  
Phase 6 can proceed in parallel with Phase 3.

## MVP Scope

**User Story 1 deliverable** (independently testable):
- `agentHostClient.ts` with `listAgents()` and `listGhostSessions()`
- `CatalogPanel.tsx` showing the agent catalog (no spawn yet)
- `AdminPanel.tsx` session click → opens CatalogPanel
- `App.tsx` left overlay updated to show CatalogPanel when a session is selected

**Full feature** adds spawn orchestration (`registryClient.ts`), `GhostListPanel.tsx`, shutdown, `DetailPanel`, and keyboard handling.
