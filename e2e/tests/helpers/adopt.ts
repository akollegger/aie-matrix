const BASE = process.env["WORLD_API_BASE"] ?? "http://127.0.0.1:8787";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

export interface GhostCredential {
  ghostId: string;
  token: string;
  worldApiBaseUrl: string;
}

export async function adopt(label = "e2e"): Promise<GhostCredential> {
  const { caretakerId } = await postJson<{ caretakerId: string }>("/registry/caretakers", {
    label,
  });
  const { agentHostId } = await postJson<{ agentHostId: string }>("/registry/houses", {
    displayName: `${label}-house`,
  });
  const { ghostId, credential } = await postJson<{
    ghostId: string;
    credential: { token: string; worldApiBaseUrl: string };
  }>("/registry/adopt", { caretakerId, agentHostId });
  return { ghostId, token: credential.token, worldApiBaseUrl: credential.worldApiBaseUrl };
}
