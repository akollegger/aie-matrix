# Quickstart: Admin Ghost Management Panel

**Feature**: 019-ghost-management  
**Audience**: Developer implementing or testing this feature

---

## Prerequisites

- `pnpm install` completed at repo root
- Ports used: world API `8787`, agent-host `4000`, map-editor dev server `5173`

---

## Step 1: Start local services

```bash
# Terminal 1 — world API + registry
pnpm dev

# Terminal 2 — agent-host (from server/agent-host)
cd server/agent-host
pnpm dev

# Terminal 3 — random-agent ghost (registers itself with agent-host on startup)
cd ghosts/random-agent
AGENT_HOST_URL=http://localhost:4000 \
AGENT_SELF_URL=http://localhost:3001 \
pnpm dev
```

After ~5 seconds, verify the agent registered:
```bash
curl http://localhost:4000/v1/catalog
# Should return { "agents": [{ "agentId": "random-agent-...", ... }] }
```

---

## Step 2: Configure map-editor env

Create `tools/map-editor/.env.local` (gitignored):

```env
VITE_API_BASE_URL=http://localhost:8787
VITE_ADMIN_TOKEN=dev
VITE_AGENT_HOST_URL=http://localhost:4000
VITE_AGENT_HOST_BEARER=dev
```

(`AGENT_HOST_TOKEN` defaults to `"dev"` in local `server/agent-host/.env.local` — check there if the value differs.)

---

## Step 3: Start the map-editor dev server

```bash
cd tools/map-editor
pnpm dev
# Opens at http://localhost:5173
```

---

## Step 4: Create and start a world session (if none exists)

1. Open `http://localhost:5173`
2. Click **Admin** in the top mode bar
3. In the left sidebar, find a published map (or click **Save** on the editor buffer to publish)
4. Hover the map row → click **+ Session** → enter a name → click **Start**
5. Verify the session count badge appears on the map row

---

## Smoke Test Scenarios

### S1: Maps → Sessions drill-down (Miller columns)

1. In Admin mode, click a map row that has at least one active session
2. A **CatalogPanel** slides in to the right, showing the active session(s) for that map
3. Click ✕ on the CatalogPanel → it closes; map row remains selected in the sidebar

### S2: Session → Agent Catalog

1. Click a session row in the CatalogPanel
2. A **GhostListPanel** slides in to the right, showing the agent catalog (agents registered with the agent-host)
3. Each row shows: Agent ID, Tier badge (Wanderer/Listener/Social), Built-in flag, About text
4. Click a catalog row → it expands inline showing the full agent card JSON

### S3: One-click ghost spawn

1. With a session selected and an agent row visible, click **Spawn Ghost** on an agent row
2. Observe: button briefly shows "Spawning…" state
3. On success: an inline success message shows `sessionId: 01J...`
4. No form input is required from the operator

### S4: Ghost session list

1. After a successful spawn, click the **Ghosts** section (or observe the GhostListPanel update)
2. The new ghost session appears with: Session ID, Agent ID, Ghost ID, Status = "spawning" → "running"
3. The `mcpToken` field is ABSENT from the UI

### S5: Shutdown a ghost session

1. In the ghost session list, click **Shutdown** on a row
2. The session row disappears after reload
3. Click ↻ (reload) to confirm it's gone

### S6: Error states

- Stop the agent-host process → click Spawn Ghost → inline error appears (not a page reload)
- Stop the world API process → navigate to Admin → banner "World API is not reachable — check VITE_API_BASE_URL"
- Use a wrong `VITE_AGENT_HOST_BEARER` → inline 401 error on any agent-host operation

---

## Verifying env vars are wired correctly

```bash
# From tools/map-editor directory
pnpm build 2>&1 | grep -i "VITE_AGENT"
# Should not warn about missing env vars
```

---

## Production environment variables (for reference)

In `deploy/staging/README.md` and the CI workflow, these must be set:

| Variable                | GCP Secret / CI Source          |
|-------------------------|---------------------------------|
| `VITE_API_BASE_URL`     | Already present                 |
| `VITE_AGENT_HOST_URL`   | `VITE_AGENT_HOST_URL` secret    |
| `VITE_AGENT_HOST_BEARER`| `AGENT_HOST_TOKEN` secret       |
