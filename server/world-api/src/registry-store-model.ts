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
  agentHostId: string;
  caretakerId: string;
  h3Index: string;
  status: "active" | "stopped";
}

export interface RegistryStoreLike {
  houses: Map<string, AgentHostRecord>;
  caretakers: Map<string, CaretakerRecord>;
  ghosts: Map<string, GhostRecord>;
  /** caretaker → active ghost id */
  activeByCaretaker: Map<string, string>;
}
