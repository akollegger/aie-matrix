import type { AgentCard } from "@a2a-js/sdk";

/** In-memory + catalog — see `specs/009-ghost-house-a2a/data-model.md` */
export type CatalogEntry = {
  readonly agentId: string;
  readonly baseUrl: string;
  readonly agentCard: AgentCard;
  readonly registeredAt: string;
  readonly builtIn: boolean;
};

export type AgentSessionStatus =
  | "spawning"
  | "running"
  | "unhealthy"
  | "restarting"
  | "failed"
  | "shutdown";

export type WorldCredential = {
  readonly token: string;
  /** Full Streamable HTTP MCP URL including `/mcp` (same shape as adopt response). */
  readonly worldApiBaseUrl: string;
};

export type AgentSession = {
  readonly sessionId: string;
  readonly agentId: string;
  readonly ghostId: string;
  status: AgentSessionStatus;
  restartCount: number;
  lastHealthCheckAt: Date | null;
  spawnedAt: Date;
  /** Opaque key the agent uses on `houseEndpoints.mcp` to authorize the proxy. */
  readonly mcpToken: string;
  readonly worldCredential: WorldCredential;
  readonly requiredTools: readonly string[];
  currentTaskId: string | null;
  currentA2AContextId: string | null;
  spawnClient?: import("@a2a-js/sdk/client").Client;
};

export type WorldEventKind =
  | "world.message.new"
  | "world.proximity.enter"
  | "world.proximity.exit"
  | "world.quest.trigger"
  | "world.session.start"
  | "world.session.end";

export type WorldEvent = {
  readonly schema: "aie-matrix.world-event.v1";
  readonly eventId: string;
  readonly ghostId: string;
  readonly kind: WorldEventKind;
  readonly payload: Record<string, unknown>;
  readonly sentAt: string;
};

export type GhostCard = {
  readonly class: string;
  readonly displayName: string;
  readonly partnerEmail: string | null;
};

/**
 * @see `specs/009-ghost-house-a2a/contracts/ic-006-spawn-context.md`
 */
export type SpawnContext = {
  readonly schema: "aie-matrix.ghost-house.spawn-context.v1";
  readonly ghostId: string;
  readonly ghostCard: GhostCard;
  readonly worldEntryPoint: string;
  readonly houseEndpoints: { readonly mcp: string; readonly a2a: string };
  readonly token: string;
  readonly expiresAt: string;
};
