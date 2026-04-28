import { useCallback, useEffect, useState } from "react";
import type { GhostIdentity } from "../types/ghost.js";

const empty = new Map<string, GhostIdentity>();

type AgentMeta = { tier: string; about: string };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Joins GET /v1/sessions (one entry per ghost instance) with GET /v1/catalog
 * (one entry per agent type) to produce a GhostIdentity map keyed by ghostId.
 */
export function useGhostIdentity(ghostHouseUrl: string) {
  const [identities, setIdentities] = useState<ReadonlyMap<string, GhostIdentity>>(empty);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!ghostHouseUrl) {
      setIdentities(empty);
      setIsLoading(false);
      return;
    }
    const base = ghostHouseUrl.endsWith("/") ? ghostHouseUrl : `${ghostHouseUrl}/`;
    setIsLoading(true);
    try {
      const [sessionsData, catalogData] = await Promise.all([
        fetchJson<{ sessions: { ghostId: string; agentId: string; status: string }[] }>(
          new URL("v1/sessions", base).toString(),
        ),
        fetchJson<{ agents: { agentId: string; tier: string; about: string }[] }>(
          new URL("v1/catalog", base).toString(),
        ),
      ]);

      const agentMeta = new Map<string, AgentMeta>();
      for (const a of catalogData.agents ?? []) {
        agentMeta.set(a.agentId, { tier: a.tier ?? "agent", about: a.about ?? "" });
      }

      const m = new Map<string, GhostIdentity>();
      for (const s of sessionsData.sessions ?? []) {
        const meta = agentMeta.get(s.agentId);
        m.set(s.ghostId, {
          ghostId: s.ghostId,
          agentId: s.agentId,
          name: meta?.about?.trim() ? meta.about.trim().slice(0, 200) : s.ghostId.slice(0, 12),
          ghostClass: meta?.tier && meta.tier.length > 0 ? meta.tier : "agent",
        });
      }
      setIdentities(m);
    } catch {
      setIdentities(empty);
    } finally {
      setIsLoading(false);
    }
  }, [ghostHouseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { identities, refresh, isLoading };
}
