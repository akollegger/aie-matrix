# Tasks: Admin Ghost Management Panel

**Input**: Design documents from `specs/019-ghost-management/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Tests**: No automated UI tests (manual smoke tests per quickstart.md). Each user story phase ends with an independently runnable smoke test.

**Organization**: Tasks are grouped by user story per the Miller columns drill-down hierarchy: Maps → Sessions → Agent Catalog → Ghost Sessions.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1 / US2 / US3)

---

## Phase 1: Setup

**Purpose**: Install new dependency, scaffold directory structure, declare new env vars.

- [ ] T001 Install `unique-names-generator` in `tools/map-editor/package.json` via `pnpm add unique-names-generator` in `tools/map-editor/`
- [ ] T002 [P] Add `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER` env vars to `tools/map-editor/.env.example` with comments matching the existing pattern
- [ ] T003 [P] Create directory structure: `tools/map-editor/src/panels/admin/`, `tools/map-editor/src/panels/detail/`, `tools/map-editor/src/hooks/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared selection state, base service types/errors, and App.tsx overlay scaffold — required before any user story panel can be rendered.

**⚠️ CRITICAL**: No user story panel work can begin until this phase is complete.

- [ ] T004 Create `tools/map-editor/src/hooks/useAdminSelection.ts` with `AdminSelection` interface (`selectedSessionId`, `selectedAgentId`, `selectedGhostSessionId`) and hook returning `selection` + `selectSession`, `selectAgent`, `selectGhostSession` setters; each setter clears deeper levels (e.g., `selectSession(null)` clears agentId and ghostSessionId too)
- [ ] T005 [P] Create `tools/map-editor/src/services/agentHostClient.ts` with base setup: `agentHostUrl` and `agentHostBearer` from `import.meta.env`, `AgentHostError` class with `status: number`, auth header helper, `AgentCatalogEntry` and `GhostSessionRecord` TypeScript interfaces — no fetch calls yet
- [ ] T006 Update `tools/map-editor/src/App.tsx` to: instantiate `useAdminSelection()` at App level; add a horizontal-flex left overlay container in admin mode; add a right overlay slot in admin mode (both empty until panels added in later tasks)

**Checkpoint**: `pnpm typecheck` in `tools/map-editor/` passes with no errors.

---

## Phase 3: User Story 1 — View Live World Sessions (Priority: P1) 🎯 MVP

**Goal**: Operator opens Admin mode, clicks a session under a map in the left sidebar, and sees the CatalogPanel slide in to the right — confirming the session is reachable and showing the panel header with session context. No agent catalog data yet.

**Independent Test**: Start local services per quickstart.md Step 1–3. Start a world session per Step 4. In Admin mode: click the session row → CatalogPanel appears with session name in header. Click ✕ → CatalogPanel closes. Verifies smoke test S1.

- [ ] T007 [US1] Extend `tools/map-editor/src/panels/AdminPanel.tsx` to: accept `onSelectSession: (id: string | null) => void` and `selectedSessionId: string | null` props; make session child rows clickable (call `onSelectSession(session.id)` on click); highlight the selected session row with a distinct background; add a `▶` affordance on the selected session row indicating CatalogPanel is open
- [ ] T008 [US1] Create `tools/map-editor/src/panels/admin/CatalogPanel.tsx` as a panel shell: 280px wide, `#16162a` background, top header showing "Catalog · {sessionId}" + ↻ Reload button + ✕ close button (`onClose` prop); body placeholder "Loading agents…" state; error banner slot for "Agent host is not reachable — check VITE_AGENT_HOST_URL" (FR-013); close button calls `onClose`
- [ ] T009 [US1] Update `tools/map-editor/src/App.tsx` left overlay container (from T006) to render `<AdminPanel onSelectSession={selectSession} selectedSessionId={selection.selectedSessionId} />` and, when `selection.selectedSessionId` is non-null, render `<CatalogPanel sessionId={selection.selectedSessionId} onClose={() => selectSession(null)} ... />`

**Checkpoint**: Smoke test S1 passes — session click opens CatalogPanel; ✕ closes it; map editor remains visible behind the overlay.

---

## Phase 4: User Story 2 — Browse the Agent Catalog and Spawn a Ghost (Priority: P2)

**Goal**: Operator sees the registered agents in CatalogPanel, can expand a row to view the full agent card, click Spawn Ghost to automatically acquire registry credentials and spawn a ghost, and sees the returned sessionId inline. Deregister button surfaces 409 errors correctly.

**Independent Test**: Start local services per quickstart.md Step 1–3 with random-agent running. Select a session → CatalogPanel shows `random-agent-<pod>` with Wanderer badge. Click Spawn Ghost → success inline shows a sessionId. Click Deregister on an agent with active sessions → inline error "Cannot deregister: N active sessions". Verifies smoke tests S2 and S3.

- [ ] T010 [P] [US2] Add `listAgents()`, `getAgentCard(agentId)`, and `deregisterAgent(agentId)` functions to `tools/map-editor/src/services/agentHostClient.ts`; `listAgents()` must extract `tier` from `agentCard.matrix.tier` and `about` from `agentCard.matrix.profile.about` before returning; `deregisterAgent()` must parse 409 response for `count` and throw `AgentHostError(409, "Cannot deregister: N active sessions")`
- [ ] T011 [P] [US2] Create `tools/map-editor/src/services/registryClient.ts` with `oneClickSpawn(agentId: string): Promise<{ sessionId: string; ghostId: string }>` that executes the four-step registry chain: `POST /registry/houses` → `POST /registry/caretakers` (unique name via `uniqueNamesGenerator`) → `POST /registry/adopt` → `spawnGhost()` from agentHostClient; re-export `worldApiUrl` derived from `VITE_API_BASE_URL`
- [ ] T012 [US2] Implement full agent table in `tools/map-editor/src/panels/admin/CatalogPanel.tsx`: call `listAgents()` on mount and on ↻ reload; display rows with Agent ID, Tier badge (amber = wanderer, blue = listener, green = social), Built-in flag, About text; row click expands an inline `<pre>` with `JSON.stringify(agentCard, null, 2)`; Spawn Ghost button calls `oneClickSpawn(agentId)` — show "Spawning…" state, success inline `sessionId: ...`, error inline; Deregister button calls `deregisterAgent(agentId)` — show 409 error inline per row; empty state "No agents registered"; agent host error banner per FR-013
- [ ] T013 [US2] Create `tools/map-editor/src/panels/admin/GhostListPanel.tsx` shell: 280px wide panel with header "Ghosts · {agentId}" + ↻ Reload + ✕ close button (`onClose` prop); body placeholder "Loading ghost sessions…"; accepts `agentId`, `onClose`, `onSelectGhostSession`, `selectedGhostSessionId` props
- [ ] T014 [US2] Update `tools/map-editor/src/App.tsx`: pass `onSelectAgent={selectAgent} selectedAgentId={selection.selectedAgentId}` to CatalogPanel; render `<GhostListPanel agentId={selection.selectedAgentId} onClose={() => selectAgent(null)} ... />` in the left overlay when `selection.selectedAgentId` is non-null

**Checkpoint**: Smoke tests S2 and S3 pass — agent catalog visible, Spawn Ghost creates a ghost session and shows sessionId, Deregister with active sessions shows inline error.

---

## Phase 5: User Story 3 — Monitor and Shut Down Ghost Sessions (Priority: P3)

**Goal**: Operator sees all active ghost sessions for the selected agent in GhostListPanel, can view their status, and shut them down. A right-side DetailPanel shows detail for the selected item. `mcpToken` never appears in any rendered output.

**Independent Test**: Spawn at least one ghost per S3. Click the agent row in CatalogPanel → GhostListPanel shows the ghost session with status "running". Click Shutdown → row disappears after ↻ reload. Open browser DevTools and confirm "mcpToken" string does not appear anywhere in the DOM. Verifies smoke tests S4 and S5.

- [ ] T015 [P] [US3] Add `listGhostSessions()` and `shutdownGhostSession(sessionId)` to `tools/map-editor/src/services/agentHostClient.ts`; `listGhostSessions()` MUST strip `mcpToken` before returning `GhostSessionRecord[]` — verify via `Object.keys(session).includes("mcpToken") === false` assertion during development
- [ ] T016 [US3] Implement `tools/map-editor/src/panels/admin/GhostListPanel.tsx` fully: call `listGhostSessions()` on mount filtered by `agentId`; display rows with Session ID (truncated to 12 chars), Ghost ID, Status (styled for known values: running = green, failed = red, others = default); Shutdown button calls `shutdownGhostSession(sessionId)`, shows inline error on failure, refreshes list on success; empty state "No active ghost sessions"; explicitly assert `mcpToken` does not appear anywhere in the JSX (add a comment noting FR-012 compliance)
- [ ] T017 [P] [US3] Create `tools/map-editor/src/panels/detail/DetailPanel.tsx`: 280px wide right overlay, matches existing right sidebar styling; cold start (no selection): "Select a session or agent to inspect"; when `selectedGhostSessionId` is set: fetch and display ghost session detail (sessionId, agentId, ghostId, status) without mcpToken
- [ ] T018 [US3] Update `tools/map-editor/src/App.tsx` right overlay: in admin mode, render `<DetailPanel selection={selection} />` (replaces the edit sidebar); in edit mode, restore the existing edit sidebar — ensure modes are mutually exclusive

**Checkpoint**: Smoke tests S4 and S5 pass — ghost sessions visible, shutdown works, mcpToken absent from DOM per S6 (use browser DevTools → Ctrl+F on "mcpToken").

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Keyboard navigation, CI/CD env var wiring, documentation updates.

- [ ] T019 [P] Add Esc key handler to `tools/map-editor/src/panels/admin/CatalogPanel.tsx` (Esc → calls `onClose`) and `tools/map-editor/src/panels/admin/GhostListPanel.tsx` (Esc → calls `onClose`) using `useEffect` + `document.addEventListener("keydown", ...)` scoped to panel mount
- [ ] T020 [P] Add `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER` build args to the map-editor build step in `.github/workflows/production-deploy.yml`, sourced from the `aie-matrix-secrets` GCP secret (same pattern as existing `VITE_ADMIN_TOKEN`)
- [ ] T021 [P] Add `VITE_AGENT_HOST_URL` and `VITE_AGENT_HOST_BEARER` to the environment variable table in `deploy/staging/README.md`
- [ ] T022 [P] Update `specs/018-ghost-agent-deployment/quickstart.md` to reference the admin panel (`admin.matrix.relateby.dev`) as the preferred operator path for spawning ghosts
- [ ] T023 [P] Update `ghosts/README.md` to note that ghost spawning can be done via the admin panel without terminal access
- [ ] T024 Update `proposals/rfc/0014-admin-ghost-management.md` status note: add a comment that the implemented IA uses Miller columns (Maps → Sessions → Catalog → Ghosts) rather than the two-tab layout originally described
- [ ] T025 Run all six quickstart.md smoke tests (S1–S6) and document results in `specs/019-ghost-management/quickstart.md` under a "Verified" section with date

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup (T001–T003) — no dependencies, start immediately
  ↓
Phase 2: Foundational (T004–T006) — depends on Phase 1 completing
  ↓ BLOCKS all user story panels
Phase 3: US1 (T007–T009) — depends on Phase 2
Phase 4: US2 (T010–T014) — depends on Phase 2 (can start in parallel with US1)
Phase 5: US3 (T015–T018) — depends on Phase 2 (can start in parallel with US1/US2)
  ↓
Phase 6: Polish (T019–T025) — depends on US1+US2+US3 complete
```

### Within-Phase Sequential Constraints

- T009 (App.tsx AdminPanel) → T014 (App.tsx CatalogPanel) → T018 (App.tsx DetailPanel): same file, sequential
- T005 (agentHostClient base) → T010 (add catalog fns) → T015 (add session fns): same file, sequential

### Parallel Opportunities

In Phase 1: T002 and T003 can run in parallel with each other.  
In Phase 2: T005 and T004 can run in parallel.  
In Phase 4: T010 and T011 can run in parallel (different files).  
In Phase 5: T015 and T017 can run in parallel (different files).  
In Phase 6: T019, T020, T021, T022, T023 can all run in parallel.

---

## Parallel Example: Phase 4 (US2)

```bash
# T010 and T011 can be launched simultaneously — different files:
Agent: "Add listAgents(), getAgentCard(), deregisterAgent() to tools/map-editor/src/services/agentHostClient.ts"
Agent: "Create tools/map-editor/src/services/registryClient.ts with oneClickSpawn()"

# After T010 completes, T012 can start:
Agent: "Implement full agent table in tools/map-editor/src/panels/admin/CatalogPanel.tsx"

# T013 can start any time after T006:
Agent: "Create GhostListPanel.tsx shell in tools/map-editor/src/panels/admin/GhostListPanel.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T006) — **CRITICAL blocker**
3. Complete Phase 3: US1 (T007–T009)
4. **STOP and VALIDATE**: Smoke test S1 — session click opens CatalogPanel
5. Deploy / demo if needed (the existing map admin still works; the new CatalogPanel shell is a no-op until US2)

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Session click → CatalogPanel shell (MVP: operator sees panel, no data yet)
3. US2 → Full agent catalog + one-click spawn (operator can spawn ghosts)
4. US3 → Ghost session list + shutdown (operator can shut down ghosts)
5. Polish → Keyboard handling + CI wiring + docs

### Parallel Strategy (Two Developers)

After Phase 2 completes:
- **Developer A**: T007 → T008 → T009 (US1) → T012 (US2 CatalogPanel full) → T019 (Esc keys)
- **Developer B**: T010 + T011 in parallel (US2 services) → T013 → T015 → T016 → T017 (US3)
- Both: Phase 6 polish tasks in parallel after their stories are done

---

## Notes

- `mcpToken` compliance is a hard requirement (FR-012). Verify with browser DevTools search after T016 and T017.
- Tier badge colors match the existing `actionBtn` palette in AdminPanel.tsx — no new CSS framework needed.
- All error states must be inline (no `alert()`, no page reload) per FR-015.
- `unique-names-generator` is tree-shaken by Vite — only the three dictionaries imported in registryClient.ts are bundled.
- AdminPanel.tsx existing session "End" button is preserved — the new `selectSession` click target is the session name/row, not the End button.
- The `[P]` label on T006 (App.tsx) is absent intentionally — it touches the same file as T009/T014/T018 and must complete before them.
