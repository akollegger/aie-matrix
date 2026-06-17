import { randomUUID } from "node:crypto";

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
  /** Human-readable name supplied by the caller at adopt time (e.g.
   *  "Django Decypher"). The persistent identity used by social-mode
   *  cascades AND by the Barnacle handoff so the same ghost is "Django"
   *  wandering, sitting at the poker table, and returning. Optional —
   *  legacy callers (random-agent demo) leave it unset. */
  displayName?: string;
  /** Per-ghost background description (IC-008). Distinguishes NPC catalog
   *  characters sharing one agent process; absent for regular ghosts. */
  background?: string;
}

export interface RegistryStore {
  houses: Map<string, AgentHostRecord>;
  caretakers: Map<string, CaretakerRecord>;
  ghosts: Map<string, GhostRecord>;
  /** caretaker → active ghost id */
  activeByCaretaker: Map<string, string>;
}

export function createRegistryStore(): RegistryStore {
  return {
    houses: new Map(),
    caretakers: new Map(),
    ghosts: new Map(),
    activeByCaretaker: new Map(),
  };
}

export function createCaretakerId(): string {
  return randomUUID();
}

export function createAgentHostId(): string {
  return randomUUID();
}

export function createGhostId(): string {
  return randomUUID();
}
