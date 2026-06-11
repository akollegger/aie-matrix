import type { NpcAgentCatalog } from "../types.js";

export interface RosterCredential {
  /** The npc-agent's own MCP session token (used to authenticate the spawn-roster call). */
  readonly mcpToken: string;
  /** World-api base URL for each spawned ghost's MCP connection. */
  readonly worldApiBaseUrl: string;
  /** Per-ghost adoption tokens: characterId → registry token. */
  readonly characterTokens: ReadonlyMap<string, string>;
  /** npc-agent's agentId as registered in the catalog. */
  readonly agentId: string;
}

export type SpawnedCharacter = {
  readonly characterId: string;
  readonly ghostId: string;
  readonly sessionId: string;
};

export type RosterResult = {
  readonly spawned: SpawnedCharacter[];
  readonly failed: Array<{ characterId: string; reason: string }>;
  /** characterId → ghostId for spawned characters */
  readonly ghostIdByCharacter: ReadonlyMap<string, string>;
};

/**
 * Spawn one ghost per enabled catalog character via the agent-host spawn-roster endpoint.
 * Per-character failures do not abort the batch.
 */
export async function spawnRoster(
  agentHostUrl: string,
  agentId: string,
  sessionId: string,
  catalog: NpcAgentCatalog,
  credential: RosterCredential,
): Promise<RosterResult> {
  const enabled = catalog.enabled();
  if (enabled.length === 0) {
    console.info(JSON.stringify({ kind: "npc-agent.roster.empty-catalog", sessionId }));
    return { spawned: [], failed: [], ghostIdByCharacter: new Map() };
  }

  const characters = enabled.map((char) => ({
    characterId: char.id,
    displayName: char.name,
    background: char.background,
    credential: {
      token: credential.characterTokens.get(char.id) ?? "",
      worldApiBaseUrl: credential.worldApiBaseUrl,
    },
  }));

  const url = `${agentHostUrl}/v1/sessions/spawn-roster/${encodeURIComponent(agentId)}`;
  let raw: { spawned?: unknown[]; failed?: unknown[] };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.mcpToken}`,
      },
      body: JSON.stringify({ sessionId, characters }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        JSON.stringify({ kind: "npc-agent.roster.spawn-http-error", status: res.status, body }),
      );
      return {
        spawned: [],
        failed: enabled.map((c) => ({ characterId: c.id, reason: `http ${res.status}` })),
        ghostIdByCharacter: new Map(),
      };
    }
    raw = (await res.json()) as { spawned?: unknown[]; failed?: unknown[] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ kind: "npc-agent.roster.spawn-fetch-error", error: msg }));
    return {
      spawned: [],
      failed: enabled.map((c) => ({ characterId: c.id, reason: msg })),
      ghostIdByCharacter: new Map(),
    };
  }

  const spawned: SpawnedCharacter[] = [];
  const failed: Array<{ characterId: string; reason: string }> = [];

  for (const s of raw.spawned ?? []) {
    const entry = s as { characterId?: string; ghostId?: string; sessionId?: string };
    if (entry.characterId && entry.ghostId) {
      spawned.push({
        characterId: entry.characterId,
        ghostId: entry.ghostId,
        sessionId: entry.sessionId ?? sessionId,
      });
    }
  }
  for (const f of raw.failed ?? []) {
    const entry = f as { characterId?: string; reason?: string };
    if (entry.characterId) {
      failed.push({ characterId: entry.characterId, reason: entry.reason ?? "unknown" });
    }
  }

  if (failed.length > 0) {
    console.warn(
      JSON.stringify({ kind: "npc-agent.roster.partial-failure", failed }),
    );
  }

  console.info(
    JSON.stringify({
      kind: "npc-agent.roster.spawned",
      sessionId,
      spawnedCount: spawned.length,
      failedCount: failed.length,
    }),
  );

  return {
    spawned,
    failed,
    ghostIdByCharacter: new Map(spawned.map((s) => [s.characterId, s.ghostId])),
  };
}
