/**
 * Structural mirror of `server/registry/src/store.ts` — kept separate so
 * `@aie-matrix/server-world-api` does not depend on `@aie-matrix/server-registry`
 * (pnpm workspace cycle). Update both files together if the store shape changes.
 */
export interface AgentHostRecord {
  id: string;
  displayName: string;
  baseUrl?: string;
  registeredAt: string;
}

export interface CaretakerRecord {
  id: string;
  label?: string;
}

export interface GhostRecord {
  id: string;
  agentHostId?: string;
  /** Specific agent catalog ID (e.g. "funder-agent"). Set when an agent-host spawns the ghost. */
  agentId?: string;
  caretakerId?: string;
  h3Index: string;
  /** Cell this ghost was placed on at adoption. Used by /respawn to teleport
   *  the ghost home (e.g. when a poker session ends, to clear the saloon tile). */
  spawnH3Index: string;
  status: "active" | "stopped";
  /** Human-readable name (e.g. "Django Decypher"). Optional; read back
   *  via GET /registry/ghosts/:id so other ghosts can resolve names. */
  displayName?: string;
}

export interface RegistryStoreLike {
  houses: Map<string, AgentHostRecord>;
  caretakers: Map<string, CaretakerRecord>;
  ghosts: Map<string, GhostRecord>;
  /** caretaker → active ghost id */
  activeByCaretaker: Map<string, string>;
}
