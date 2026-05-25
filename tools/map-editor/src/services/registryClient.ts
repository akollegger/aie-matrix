import { spawnGhost } from "./agentHostClient"

const worldApiUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "")

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${worldApiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Registry ${path} failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// One-click spawn (simplified ghost-first flow)
// ---------------------------------------------------------------------------

/**
 * Spawn a ghost via the simplified two-step flow:
 * 1. POST /registry/ghosts  → ghostId + credential  (single atomic server call, no cross-pod race)
 * 2. POST /agent-host/v1/sessions/spawn/:agentId (via agentHostClient)
 *
 * Ghosts spawn independently — no caretaker or adoption ceremony required.
 * Users can partner with a ghost later as a separate optional action.
 */
/**
 * Fetch the current H3 cell position for a ghost from the registry.
 * Uses the configured world API base URL so it works in both dev (proxy) and prod.
 */
export async function getGhostPosition(ghostId: string): Promise<{ h3Index: string; status: string }> {
  const res = await fetch(`${worldApiUrl}/registry/ghosts/${encodeURIComponent(ghostId)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<{ h3Index: string; status: string }>
}

export async function oneClickSpawn(agentId: string): Promise<{ sessionId: string; ghostId: string }> {
  // Step 1: create ghost identity (single server call)
  const { ghostId, credential } = await postJson<{
    ghostId: string
    credential: { token: string; worldApiBaseUrl: string }
  }>("/registry/ghosts", { agentId })

  // Step 2: spawn via agent-host (uses VITE_AGENT_HOST_BEARER auth)
  const { sessionId } = await spawnGhost(agentId, ghostId, credential)

  return { sessionId, ghostId }
}
