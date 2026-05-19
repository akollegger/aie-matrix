const serverUrl = (import.meta.env.VITE_SERVER_URL ?? "http://localhost:8787").replace(/\/$/, "")
const adminToken = import.meta.env.VITE_ADMIN_TOKEN ?? ""

export interface ServerMapRecord {
  mapId: string
  name: string
  status: "published" | "archived"
  publishedAt: string
  archivedAt?: string
}

export async function listMaps(): Promise<ServerMapRecord[]> {
  const res = await fetch(`${serverUrl}/maps?status=published`)
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
