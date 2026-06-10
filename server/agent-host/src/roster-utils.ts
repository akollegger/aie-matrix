import { createHash } from "node:crypto";

/**
 * T012: derives a deterministic ghostId from (sessionId, characterId) so
 * npc-agent roster spawns are restart-idempotent.
 *
 * Format: `npc-<12-char hex prefix>` (safe for ghost IDs).
 */
export function deriveCharacterGhostId(sessionId: string, characterId: string): string {
  const hash = createHash("sha256")
    .update(`npc:${sessionId}:${characterId}`)
    .digest("hex")
    .slice(0, 24);
  return `npc-${hash}`;
}
