import { uniqueNamesGenerator, adjectives, colors, animals } from "unique-names-generator"
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

function generateCaretakerName(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: "-",
    length: 3,
  })
}

// ---------------------------------------------------------------------------
// One-click spawn orchestration (IC-REGISTRY-SPAWN)
// ---------------------------------------------------------------------------

/**
 * Orchestrates the four-step ghost spawn flow:
 * 1. POST /registry/houses  → agentHostId
 * 2. POST /registry/caretakers (unique name) → caretakerId
 * 3. POST /registry/adopt   → ghostId + credential
 * 4. POST /v1/sessions/spawn/:agentId (via agentHostClient) → sessionId
 *
 * All registry endpoints are open (no authentication required).
 * The agent-host spawn call uses VITE_AGENT_HOST_BEARER from agentHostClient.
 *
 * Each caretaker gets a unique auto-generated name — never reused across spawns
 * (registry enforces one ghost per caretaker).
 */
export async function oneClickSpawn(agentId: string): Promise<{ sessionId: string; ghostId: string }> {
  // Step 1: create house record for this agent
  const { agentHostId } = await postJson<{ agentHostId: string }>(
    "/registry/houses",
    { displayName: agentId },
  )

  // Step 2: create caretaker with a unique three-word name
  const caretakerName = generateCaretakerName()
  const { caretakerId } = await postJson<{ caretakerId: string }>(
    "/registry/caretakers",
    { label: caretakerName },
  )

  // Step 3: adopt — pairs caretaker with house → ghost identity + world credential
  const { ghostId, credential } = await postJson<{
    ghostId: string
    credential: { token: string; worldApiBaseUrl: string }
  }>("/registry/adopt", { caretakerId, agentHostId })

  // Step 4: spawn via agent-host (includes VITE_AGENT_HOST_BEARER auth)
  const { sessionId } = await spawnGhost(agentId, ghostId, credential)

  return { sessionId, ghostId }
}
