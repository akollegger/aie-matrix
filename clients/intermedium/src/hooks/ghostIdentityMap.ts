import type { GhostIdentity } from "../types/ghost.js";

type SessionEntry = { ghostId: string; agentId: string; status: string; displayName?: string; characterId?: string };
type CatalogEntry = { agentId: string; tier: string; about: string };

/**
 * Builds a ghostId → GhostIdentity map from the raw /v1/sessions and /v1/catalog responses.
 * Extracted from useGhostIdentity so the mapping logic is unit-testable without a DOM.
 *
 * Name resolution priority:
 *   1. session.displayName (set by agent for named NPC characters)
 *   2. catalog agent's about field (truncated to 200 chars)
 *   3. ghostId.slice(0, 12) fallback
 */
export function buildIdentityMap(
  sessions: SessionEntry[],
  catalogAgents: CatalogEntry[],
): Map<string, GhostIdentity> {
  const agentMeta = new Map<string, { tier: string; about: string }>();
  for (const a of catalogAgents) {
    agentMeta.set(a.agentId, { tier: a.tier ?? "agent", about: a.about ?? "" });
  }

  const m = new Map<string, GhostIdentity>();
  for (const s of sessions) {
    const meta = agentMeta.get(s.agentId);
    const name = s.displayName?.trim()
      ? s.displayName.trim()
      : meta?.about?.trim()
        ? meta.about.trim().slice(0, 200)
        : s.ghostId.slice(0, 12);
    m.set(s.ghostId, {
      ghostId: s.ghostId,
      agentId: s.agentId,
      name,
      ghostClass: meta?.tier && meta.tier.length > 0 ? meta.tier : "agent",
    });
  }
  return m;
}
