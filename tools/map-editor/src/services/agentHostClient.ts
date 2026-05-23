const agentHostUrl = (import.meta.env.VITE_AGENT_HOST_URL ?? "http://localhost:4000").replace(/\/$/, "")
const agentHostBearer = import.meta.env.VITE_AGENT_HOST_BEARER ?? ""

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class AgentHostError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "AgentHostError"
  }
}

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

export interface AgentCatalogEntry {
  agentId: string
  baseUrl: string
  builtIn: boolean
  registeredAt: string
  tier: "wanderer" | "listener" | "social"
  about: string
  agentCard: unknown
}

/** mcpToken is stripped before this type is ever returned to UI components (FR-012). */
export interface GhostSessionRecord {
  sessionId: string
  agentId: string
  ghostId: string
  status: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${agentHostBearer}`,
    "Content-Type": "application/json",
  }
}

async function handleResponse(res: Response, context: string): Promise<unknown> {
  if (res.ok) {
    return res.json()
  }
  let body: { error?: string; code?: string; count?: number } = {}
  try {
    body = (await res.json()) as typeof body
  } catch {
    // ignore parse errors — use status code only
  }
  throw new AgentHostError(res.status, body.error ?? `${context} failed: HTTP ${res.status}`)
}

async function agentFetch(path: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(`${agentHostUrl}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    })
    return handleResponse(res, path)
  } catch (e) {
    if (e instanceof AgentHostError) throw e
    throw new AgentHostError(
      -1,
      "Agent host is not reachable — check VITE_AGENT_HOST_URL",
    )
  }
}

// ---------------------------------------------------------------------------
// Catalog endpoints
// ---------------------------------------------------------------------------

/**
 * List all registered agents. Extracts tier and about from nested agentCard.
 * IC-AGENTHOST: GET /v1/catalog
 */
export async function listAgents(): Promise<AgentCatalogEntry[]> {
  const data = (await agentFetch("/v1/catalog")) as { agents: RawCatalogEntry[] }
  return data.agents.map(normalizeCatalogEntry)
}

interface RawCatalogEntry {
  agentId: string
  baseUrl: string
  builtIn: boolean
  registeredAt: string
  agentCard: {
    matrix?: {
      tier?: string
      profile?: { about?: string }
    }
  }
}

function normalizeCatalogEntry(raw: RawCatalogEntry): AgentCatalogEntry {
  const tier = (raw.agentCard?.matrix?.tier ?? "wanderer") as AgentCatalogEntry["tier"]
  const about = raw.agentCard?.matrix?.profile?.about ?? ""
  return {
    agentId: raw.agentId,
    baseUrl: raw.baseUrl,
    builtIn: raw.builtIn,
    registeredAt: raw.registeredAt,
    tier,
    about,
    agentCard: raw.agentCard,
  }
}

/**
 * Fetch the full A2A agent card for a single agent.
 * IC-AGENTHOST: GET /v1/catalog/:agentId
 */
export async function getAgentCard(agentId: string): Promise<unknown> {
  return agentFetch(`/v1/catalog/${encodeURIComponent(agentId)}`)
}

/**
 * Deregister an agent. Throws AgentHostError(409, "Cannot deregister: N active sessions")
 * when the agent has active sessions.
 * IC-AGENTHOST: DELETE /v1/catalog/:agentId
 */
export async function deregisterAgent(agentId: string): Promise<void> {
  try {
    await agentFetch(`/v1/catalog/${encodeURIComponent(agentId)}`, { method: "DELETE" })
  } catch (e) {
    if (e instanceof AgentHostError && e.status === 409) {
      // Parse count from message or re-throw with friendly message
      // Server returns: { error: "ActiveSessionsPreventDeregister", count: N }
      // agentFetch already threw with body.error — re-throw as a count-bearing error
      throw e
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Session endpoints
// ---------------------------------------------------------------------------

/**
 * List all active ghost supervision sessions. mcpToken is stripped before returning.
 * IC-AGENTHOST: GET /v1/sessions
 */
export async function listGhostSessions(): Promise<GhostSessionRecord[]> {
  const data = (await agentFetch("/v1/sessions")) as { sessions: Record<string, unknown>[] }
  return data.sessions.map(s => {
    // FR-012: mcpToken MUST NOT leave this function
    const { mcpToken: _stripped, ...safe } = s as Record<string, unknown>
    void _stripped
    return {
      sessionId: String(safe.sessionId ?? ""),
      agentId: String(safe.agentId ?? ""),
      ghostId: String(safe.ghostId ?? ""),
      status: String(safe.status ?? "unknown"),
    }
  })
}

/**
 * Spawn a ghost into a running world session via an agent.
 * Returns sessionId only — mcpToken from the server response is stripped.
 * IC-AGENTHOST: POST /v1/sessions/spawn/:agentId
 */
export async function spawnGhost(
  agentId: string,
  ghostId: string,
  credential: { token: string; worldApiBaseUrl: string },
): Promise<{ sessionId: string }> {
  const data = (await agentFetch(`/v1/sessions/spawn/${encodeURIComponent(agentId)}`, {
    method: "POST",
    body: JSON.stringify({ ghostId, credential }),
  })) as { sessionId: string; mcpToken?: unknown }

  // FR-012: strip mcpToken from spawn response
  const { mcpToken: _stripped, ...safe } = data
  void _stripped
  return { sessionId: safe.sessionId }
}

/**
 * Shut down an active ghost supervision session.
 * IC-AGENTHOST: DELETE /v1/sessions/:sessionId
 */
export async function shutdownGhostSession(sessionId: string): Promise<void> {
  await agentFetch(`/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
}
