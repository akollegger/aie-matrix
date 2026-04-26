import { useCallback, useEffect, useState } from "react";
import type { GhostIdentity } from "../types/ghost.js";

const empty = new Map<string, GhostIdentity>();

function toIdentity(row: { agentId: string; tier: string; about: string }): GhostIdentity {
  return {
    ghostId: row.agentId,
    name: row.about?.trim() ? String(row.about).trim().slice(0, 200) : row.agentId,
    ghostClass: row.tier && String(row.tier).length > 0 ? String(row.tier) : "agent",
  };
}

/**
 * `GET {ghostHouseUrl}/v1/catalog` (spec-009). Fails open with an empty map.
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
    setIsLoading(true);
    const headers: Record<string, string> = { Accept: "application/json" };
    const t = import.meta.env.VITE_GHOST_HOUSE_BEARER;
    if (t && t.length > 0) {
      headers.Authorization = `Bearer ${t}`;
    }
    try {
      const res = await fetch(
        new URL("v1/catalog", ghostHouseUrl.endsWith("/") ? ghostHouseUrl : `${ghostHouseUrl}/`),
        { headers },
      );
      if (!res.ok) {
        setIdentities(empty);
        return;
      }
      const data = (await res.json()) as { agents?: { agentId: string; tier: string; about: string }[] };
      const m = new Map<string, GhostIdentity>();
      for (const a of data.agents ?? []) {
        m.set(a.agentId, toIdentity(a));
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
