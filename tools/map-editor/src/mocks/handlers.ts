import { http, HttpResponse, delay } from "msw"
import {
  MOCK_CATALOG,
  MOCK_GHOST_SESSIONS,
  MOCK_MAPS,
  MOCK_SESSIONS,
  mockAdopt,
  mockCreateCaretaker,
  mockCreateHouse,
  mockShutdown,
  mockSpawn,
} from "./fixtures/index"

// Simulate realistic latency so the loading states are visible
const LATENCY = 400

// ---------------------------------------------------------------------------
// World API — map and session endpoints (VITE_API_BASE_URL)
// ---------------------------------------------------------------------------

const worldBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787"

const worldHandlers = [
  // GET /maps?status=...
  http.get(`${worldBase}/maps`, async ({ request }) => {
    await delay(LATENCY)
    const url = new URL(request.url)
    const status = url.searchParams.get("status")
    const maps = status ? MOCK_MAPS.filter(m => m.status === status) : MOCK_MAPS
    return HttpResponse.json(maps)
  }),

  // GET /maps/:mapId/gram
  http.get(`${worldBase}/maps/:mapId/gram`, async () => {
    await delay(LATENCY)
    // Return a minimal gram stub so the editor doesn't error
    return new HttpResponse(
      `graph [label="mock"] { }`,
      { headers: { "Content-Type": "text/plain" } },
    )
  }),

  // POST /maps (publish)
  http.post(`${worldBase}/maps`, async ({ request }) => {
    await delay(LATENCY)
    const form = await request.formData()
    const mapId = form.get("mapId") as string
    return HttpResponse.json({
      mapId,
      name: mapId,
      status: "published",
      publishedAt: new Date().toISOString(),
    }, { status: 201 })
  }),

  // DELETE /maps/:mapId (archive)
  http.delete(`${worldBase}/maps/:mapId`, async () => {
    await delay(LATENCY)
    return HttpResponse.json({ ok: true })
  }),

  // GET /live?status=active
  http.get(`${worldBase}/live`, async () => {
    await delay(LATENCY)
    return HttpResponse.json(MOCK_SESSIONS)
  }),

  // POST /live (start session)
  http.post(`${worldBase}/live`, async ({ request }) => {
    await delay(LATENCY)
    const body = await request.json() as { name: string; maps: Array<{ mapId: string; role: string }> }
    const newSession = {
      id: `session-${Date.now()}`,
      name: body.name,
      status: "active",
      startedAt: new Date().toISOString(),
      maps: body.maps.map(m => ({ ...m, gcsPath: `maps/${m.mapId}.map.gram` })),
    }
    MOCK_SESSIONS.push(newSession)
    return HttpResponse.json(newSession, { status: 201 })
  }),

  // DELETE /live/:sessionId (end session)
  http.delete(`${worldBase}/live/:sessionId`, async () => {
    await delay(LATENCY)
    return HttpResponse.json({ ok: true })
  }),

  // PATCH /live/:sessionId/maps (switch map)
  http.patch(`${worldBase}/live/:sessionId/maps`, async () => {
    await delay(LATENCY)
    return HttpResponse.json({ session: MOCK_SESSIONS[0], removedCells: [], addedCells: [] })
  }),

  // Registry endpoints (open, no auth)
  http.post(`${worldBase}/registry/houses`, async ({ request }) => {
    await delay(LATENCY / 2)
    const body = await request.json() as { displayName?: string }
    return HttpResponse.json(mockCreateHouse(body.displayName ?? ""), { status: 201 })
  }),

  http.post(`${worldBase}/registry/caretakers`, async ({ request }) => {
    await delay(LATENCY / 2)
    const body = await request.json() as { label?: string }
    return HttpResponse.json(mockCreateCaretaker(body.label ?? ""), { status: 201 })
  }),

  http.post(`${worldBase}/registry/adopt`, async ({ request }) => {
    await delay(LATENCY / 2)
    const body = await request.json() as { caretakerId?: string; agentHostId?: string }
    return HttpResponse.json(
      mockAdopt(body.caretakerId ?? "", body.agentHostId ?? ""),
      { status: 201 },
    )
  }),
]

// ---------------------------------------------------------------------------
// Agent-host API (VITE_AGENT_HOST_URL)
// ---------------------------------------------------------------------------

const agentHostBase = import.meta.env.VITE_AGENT_HOST_URL ?? "http://localhost:4000"

const agentHostHandlers = [
  // GET /v1/catalog
  http.get(`${agentHostBase}/v1/catalog`, async () => {
    await delay(LATENCY)
    return HttpResponse.json({ agents: MOCK_CATALOG })
  }),

  // GET /v1/catalog/:agentId
  http.get(`${agentHostBase}/v1/catalog/:agentId`, async ({ params }) => {
    await delay(LATENCY)
    const entry = MOCK_CATALOG.find(a => a.agentId === params.agentId)
    if (!entry) {
      return HttpResponse.json({ error: "Agent not found", code: "AGENT_NOT_FOUND" }, { status: 404 })
    }
    return HttpResponse.json(entry.agentCard)
  }),

  // DELETE /v1/catalog/:agentId
  http.delete(`${agentHostBase}/v1/catalog/:agentId`, async ({ params }) => {
    await delay(LATENCY)
    const agentId = params.agentId as string
    const activeSessions = MOCK_GHOST_SESSIONS.filter(s => s.agentId === agentId)
    if (activeSessions.length > 0) {
      return HttpResponse.json(
        {
          error: `Cannot deregister: ${activeSessions.length} active sessions`,
          code: "ACTIVE_SESSIONS_PREVENT_DEREGISTER",
          count: activeSessions.length,
        },
        { status: 409 },
      )
    }
    const idx = MOCK_CATALOG.findIndex(a => a.agentId === agentId)
    if (idx !== -1) MOCK_CATALOG.splice(idx, 1)
    return HttpResponse.json({ ok: true, agentId })
  }),

  // GET /v1/sessions
  http.get(`${agentHostBase}/v1/sessions`, async () => {
    await delay(LATENCY)
    return HttpResponse.json({ sessions: MOCK_GHOST_SESSIONS })
  }),

  // POST /v1/sessions/spawn/:agentId
  http.post(`${agentHostBase}/v1/sessions/spawn/:agentId`, async ({ request, params }) => {
    await delay(LATENCY * 3) // spawn is intentionally slower to show the "Spawning…" state
    const body = await request.json() as { ghostId?: string }
    const agentId = params.agentId as string
    const entry = MOCK_CATALOG.find(a => a.agentId === agentId)
    if (!entry) {
      return HttpResponse.json({ error: "Agent not found", code: "AGENT_NOT_FOUND" }, { status: 404 })
    }
    const result = mockSpawn(agentId, body.ghostId ?? "ghost-unknown")
    return HttpResponse.json(result, { status: 201 })
  }),

  // DELETE /v1/sessions/:sessionId
  http.delete(`${agentHostBase}/v1/sessions/:sessionId`, async ({ params }) => {
    await delay(LATENCY)
    mockShutdown(params.sessionId as string)
    return HttpResponse.json({ ok: true, sessionId: params.sessionId })
  }),

  // GET /health
  http.get(`${agentHostBase}/health`, async () => {
    await delay(LATENCY / 4)
    return HttpResponse.json({ status: "ok", checks: { "world-api": true } })
  }),
]

export const handlers = [...worldHandlers, ...agentHostHandlers]
