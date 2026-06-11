import type { AgentCard } from "@a2a-js/sdk";

/** In-memory + catalog — see `specs/009-agent-host-a2a/data-model.md`.
 *  The `kind` discriminator is RFC-0019 (Barnacle Protocol):
 *    - "agent"     → traditional ghost agent (peppers-agent, random-agent)
 *                    described by an A2A AgentCard
 *    - "mini-game" → a Barnacle-Protocol-speaking session host described
 *                    by the world-item classes it claims
 *  Entries that pre-date the discriminator are treated as "agent". */
export type CatalogEntry =
  | {
      readonly kind?: "agent";
      readonly agentId: string;
      readonly baseUrl: string;
      readonly agentCard: AgentCard;
      readonly registeredAt: string;
      readonly builtIn: boolean;
      /** Resource grants seeded into the agent's ghost bag on first connect.
       *  Only honoured for built-in catalog entries; ignored on external /register payloads. */
      readonly resourceGrants?: ReadonlyArray<{
        readonly resourceId: string;
        readonly label: string;
        readonly class: "conserved" | "monotonic";
        readonly qty: number;
      }>;
    }
  | {
      readonly kind: "mini-game";
      readonly agentId: string;
      readonly baseUrl: string;
      /** World-item classes this mini-game claims (e.g. ["PokerTable"]). */
      readonly platformClasses: ReadonlyArray<string>;
      /** Optional override of the supervisor's default hard timeout (ms). */
      readonly hardTimeoutMs?: number;
      readonly registeredAt: string;
      readonly builtIn: boolean;
      /** Short human-readable description for catalog listing. */
      readonly about?: string;
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

export type GhostCard = {
  readonly class: string;
  readonly displayName: string;
  readonly partnerEmail: string | null;
  /** Per-ghost background description (IC-008). Set for NPC catalog characters. */
  readonly background?: string;
  /** Catalog character ID (IC-008). Used by npc-agent executor to map
   *  a spawned ghost back to its CharacterDefinition. */
  readonly characterId?: string;
};

/**
 * @see `specs/009-agent-host-a2a/contracts/ic-006-spawn-context.md`
 */
export type SpawnContext = {
  readonly schema: "aie-matrix.agent-host.spawn-context.v1";
  readonly ghostId: string;
  readonly ghostCard: GhostCard;
  readonly worldEntryPoint: string;
  readonly houseEndpoints: {
    readonly mcp: string;
    readonly a2a: string;
    /** World-api registry base URL — e.g. `http://127.0.0.1:8787`.
     *  The agent uses this for `GET /registry/ghosts/:id` to resolve
     *  peer displayNames. NOT the same as `a2a` (which points at the
     *  agent-host, not the world). */
    readonly registry: string;
  };
  readonly token: string;
  readonly expiresAt: string;
};

export type AgentSession = {
  readonly sessionId: string;
  readonly agentId: string;
  readonly ghostId: string;
  /** Human-readable name for this ghost (e.g. "Django Decypher").
   *  Supplied by the spawn caller (the demo script for RDC ghosts);
   *  falls through to the synthesized `ghost-<prefix>` when absent.
   *  Carried by the Barnacle handoff so the mini-game (and its overlay)
   *  see the same name peppers uses in social mode. */
  readonly displayName?: string;
  /** A2A base URL of the agent process serving this ghost. Cached at
   *  spawn from the catalog entry so the Barnacle supervisor doesn't
   *  need to re-resolve it per encounter. */
  readonly baseUrl: string;
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
  /** Set when the agent card requests push; spawn uses non-blocking A2A + setTaskPushNotificationConfig. */
  usesA2APush: boolean;
  /** Last successful IC-006 payload — used to reconnect A2A after a failed health check. */
  lastSpawnContext?: SpawnContext;
  /** Timestamps of reconnect attempts in the last hour (for T028 cap). */
  restartWindow: number[];
  /** Current exponential backoff (ms) before a reconnect; resets on success. */
  currentBackoffMs: number;
  spawnClient?: import("@a2a-js/sdk/client").Client;
};

export type WorldEventKind =
  | "world.message.new"
  | "world.proximity.enter"
  | "world.proximity.exit"
  | "world.quest.trigger"
  | "world.session.start"
  | "world.session.end"
  | "world.contract.submitted";

export type WorldEvent = {
  readonly schema: "aie-matrix.world-event.v1";
  readonly eventId: string;
  readonly ghostId: string;
  readonly kind: WorldEventKind;
  readonly payload: Record<string, unknown>;
  /** @deprecated Use `timestamp` instead. Retained for backwards compatibility. */
  readonly sentAt: string;
  /** ISO 8601 with Pacific UTC offset. Canonical timestamp for ordering and recency. */
  readonly timestamp: string;
};
