const serverUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "")
const adminToken = import.meta.env.VITE_ADMIN_TOKEN ?? ""

export interface ServerMapRecord {
  mapId: string
  name: string
  elevation?: number
  /** Storage URL — `file://` in development mode, `gs://` in production. */
  gcsPath?: string
  contentHash?: string
  status: "published" | "archived"
  publishedAt: string
  archivedAt?: string
}

export interface ServerSessionRecord {
  id: string
  name: string
  status: "active" | "ended"
  startedAt: string
  endedAt?: string
  maps: Array<{ mapId: string; role: string; gcsPath: string }>
}

export async function listMaps(status?: "published" | "archived"): Promise<ServerMapRecord[]> {
  const url = status ? `${serverUrl}/maps?status=${status}` : `${serverUrl}/maps`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`listMaps failed: ${res.status}`)
  return res.json() as Promise<ServerMapRecord[]>
}

export async function publishMap(mapId: string, gramText: string): Promise<ServerMapRecord> {
  const form = new FormData()
  form.append("mapId", mapId)
  form.append("file", new Blob([gramText], { type: "text/plain" }), `${mapId}.map.gram`)

  const res = await fetch(`${serverUrl}/maps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`publishMap failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<ServerMapRecord>
}

export async function loadMapGram(mapId: string): Promise<string> {
  const res = await fetch(`${serverUrl}/maps/${encodeURIComponent(mapId)}/gram`)
  if (!res.ok) throw new Error(`loadMapGram failed: ${res.status}`)
  return res.text()
}

export async function archiveMap(mapId: string): Promise<void> {
  const res = await fetch(`${serverUrl}/maps/${encodeURIComponent(mapId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`archiveMap failed (${res.status}): ${body}`)
  }
}

export async function listSessions(status?: "active" | "ended"): Promise<ServerSessionRecord[]> {
  const url = status ? `${serverUrl}/live?status=${status}` : `${serverUrl}/live`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`listSessions failed: ${res.status}`)
  return res.json() as Promise<ServerSessionRecord[]>
}

export async function startSession(name: string, mapId: string): Promise<ServerSessionRecord> {
  const res = await fetch(`${serverUrl}/live`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, maps: [{ mapId, role: "primary" }] }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`startSession failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<ServerSessionRecord>
}

export async function switchSessionMap(
  sessionId: string,
  mapId: string,
): Promise<{ session: ServerSessionRecord; removedCells: string[]; addedCells: string[] }> {
  const res = await fetch(`${serverUrl}/live/${encodeURIComponent(sessionId)}/maps`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ maps: [{ mapId, role: "primary" }] }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`switchSessionMap failed (${res.status}): ${body}`)
  }
  return res.json() as Promise<{ session: ServerSessionRecord; removedCells: string[]; addedCells: string[] }>
}

export async function endSession(sessionId: string): Promise<void> {
  const res = await fetch(`${serverUrl}/live/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`endSession failed (${res.status}): ${body}`)
  }
}
