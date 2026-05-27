/**
 * A2A message schemas for RDC ghosts.
 *
 * The orchestrator sends typed JSON-data messages to an RDC agent via
 * A2A. The executor inspects the `schema` field on incoming data parts
 * to route to the correct handler.
 *
 * Schemas:
 *   spawn-context.v1   — kicks off the social cascade loop (peppers).
 *   poker.invite.v1    — orchestrator asks: do you want to join this hand?
 *   poker.turn.v1      — your action is required at the table.
 *   poker.outcome.v1   — hand resolved; here's what happened.
 */

export const RDC_SPAWN_CONTEXT_SCHEMA = "aie-matrix.ghost-house.spawn-context.v1";
export const RDC_POKER_SPAWN_SCHEMA = "aie-matrix.rdc.poker-spawn.v1";
export const RDC_POKER_INVITE_SCHEMA = "aie-matrix.rdc.poker.invite.v1";
export const RDC_POKER_TURN_SCHEMA = "aie-matrix.rdc.poker.turn.v1";
export const RDC_POKER_OUTCOME_SCHEMA = "aie-matrix.rdc.poker.outcome.v1";
export const RDC_POKER_REFLECT_SCHEMA = "aie-matrix.rdc.poker.reflect.v1";
export const RDC_PLATFORM_ENCOUNTER_SCHEMA = "aie-matrix.rdc.platform.encounter.v1";
export const RDC_PLATFORM_EXIT_SCHEMA = "aie-matrix.rdc.platform.exit.v1";

/**
 * Poker-only spawn — populates ghost state without starting the social
 * cascade loop. Used by the demo to exercise the poker stack end-to-end
 * before the full world-api wiring is in place.
 */
export interface RdcPokerSpawn {
  readonly schema: typeof RDC_POKER_SPAWN_SCHEMA;
  readonly ghostId: string;
  readonly displayName: string;
  readonly birthSeed: number;
  readonly rdcRole?: "outlaw" | "marshall";
}

export interface RdcSpawnContext {
  readonly schema: typeof RDC_SPAWN_CONTEXT_SCHEMA;
  readonly ghostId: string;
  readonly houseEndpoints: { readonly mcp: string; readonly a2a: string };
  readonly token: string;
  readonly worldEntryPoint: string;
  readonly ghostCard: { readonly class: string; readonly displayName: string };
  readonly expiresAt: string;
  /** RDC-specific role flag: outlaw or marshall (cosmetic for v1). */
  readonly rdcRole?: "outlaw" | "marshall";
  /** Personality seed — agent generates its slider profile from this. */
  readonly birthSeed?: number;
}

export interface RdcPokerInvite {
  readonly schema: typeof RDC_POKER_INVITE_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  readonly buyIn: number;
  readonly maxPlayers: number;
  readonly currentPlayers: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** Free-text description ("Saloon, Black Bart's table") for monologue color. */
  readonly setting: string;
}

export interface RdcPokerInviteReply {
  readonly schema: typeof RDC_POKER_INVITE_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  readonly accept: boolean;
  readonly reasoning: string;
  /**
   * Slider-derived fitness for each Hellmuth animal type. The
   * orchestrator collects these from every acceptor and runs an
   * assignment so each seated player gets a unique type.
   */
  readonly animalFitness?: Readonly<{
    mouse: number;
    lion: number;
    jackal: number;
    elephant: number;
    eagle: number;
  }>;
}

/**
 * Sent every time the agent is on-the-clock to act.
 * The full game state plus the agent's own slider profile shape the call.
 */
export interface RdcPokerTurn {
  readonly schema: typeof RDC_POKER_TURN_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  /** Public game state (the orchestrator omits other players' hole cards). */
  readonly gameState: import("@aie-matrix/ghost-rdc-poker").GameState;
  /** Pre-computed legal moves. */
  readonly availableActions: import("@aie-matrix/ghost-rdc-poker").AvailableActions;
  /**
   * Recent hand-by-hand opponent reads from memory ("ghost_X three-bet me out
   * of position last hand"). One bullet per opponent per relevant hand.
   */
  readonly opponentReads?: ReadonlyArray<string>;
  /**
   * Table talk uttered earlier in this hand, oldest first. Lets the
   * brain respond IN CHARACTER to what's been said — answer questions,
   * needle, defuse, dodge — instead of emitting independent quips.
   *
   * `toName` is the addressee parsed from the speaker's `@<Name>:`
   * prefix, or `null` if the speech was general table-talk.
   */
  readonly recentTableTalk?: ReadonlyArray<{
    readonly fromName: string;
    readonly text: string;
    readonly toName?: string | null;
  }>;
  /**
   * Hellmuth animal type assigned to THIS player by the orchestrator
   * for this hand. The brain uses it as a self-image.
   */
  readonly myAnimalType?: "mouse" | "lion" | "jackal" | "elephant" | "eagle";
  /**
   * Map of seated displayName → animal type. Lets the brain reason
   * about specific opponents — "the mouse won't call without a hand,
   * the elephant will call my value bet down with bottom pair."
   */
  readonly tableAnimalTypes?: Readonly<
    Record<
      string,
      "mouse" | "lion" | "jackal" | "elephant" | "eagle"
    >
  >;
  /**
   * Current skill tier from the orchestrator's ledger (RFC-0018). Gates
   * how rich the math block in the LLM prompt is — Greenhorns get none;
   * Veterans/Eagles get extra reasoning hints. Omit for legacy callers.
   */
  readonly skillTier?: "Greenhorn" | "Journeyman" | "Veteran" | "Eagle";
}

export interface RdcPokerTurnReply {
  readonly schema: typeof RDC_POKER_TURN_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  readonly action: import("@aie-matrix/ghost-rdc-poker").ActionType;
  readonly amount: number;
  /** What the brain was thinking — emitted into the overlay for the user to read. */
  readonly reasoning: string;
  /** 0..1; how confident the brain is in this line. */
  readonly confidence: number;
  /**
   * Optional table talk — if non-empty, the orchestrator will broadcast it
   * via the world-api `say` so other ghosts see it in cluster chat.
   */
  readonly tableTalk?: string;
}

/**
 * Triennial-reflection task. Sent every 3 hands so each agent can
 * weigh whether their current animal type is working out and either
 * stick with it or ask to switch. Reply triggers a fresh table-wide
 * Hellmuth assignment.
 */
export interface RdcPokerReflect {
  readonly schema: typeof RDC_POKER_REFLECT_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  readonly currentAnimal: "mouse" | "lion" | "jackal" | "elephant" | "eagle";
  /** Cyphers balance right now. */
  readonly currentBalance: number;
  /** Net balance change since the previous reflection. */
  readonly netSinceLastReflection: number;
  /** Hand counter — how many hands the table has played so far. */
  readonly handsPlayed: number;
  /** Optional one-line summaries of recent outcomes. */
  readonly recentOutcomes?: ReadonlyArray<string>;
}

export interface RdcPokerReflectReply {
  readonly schema: typeof RDC_POKER_REFLECT_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  /**
   * Three-way outcome of the reflection:
   *   - "stick"  → keep your current animal type, stay seated
   *   - "switch" → keep your seat but switch animal (orchestrator
   *                forbids your current type and reassigns)
   *   - "leave"  → release your seat, go back to social mode
   */
  readonly decision: "stick" | "switch" | "leave";
  readonly reasoning: string;
}

/**
 * Platform encounter — orchestrator dispatches when a registered RDC
 * ghost is detected on (or near) a saloon-tile platform. The agent
 * decides whether to engage. On accept the orchestrator seats them
 * (or queues if full); on decline the orchestrator leaves them be.
 *
 * From the world's POV this is purely orchestrator-managed: no
 * world-api call is made; agents under the AR-for-AI model perceive
 * platforms differently per house.
 */
export interface RdcPlatformEncounter {
  readonly schema: typeof RDC_PLATFORM_ENCOUNTER_SCHEMA;
  readonly platformId: string;
  readonly ghostId: string;
  readonly platformType: "poker"; // future: arcade, duel, etc.
  readonly seatsOpen: number;
  readonly seatsTotal: number;
  readonly seatedNames: ReadonlyArray<string>;
  readonly waitingCount: number;
  readonly buyIn: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** Free text for the brain's flavour — "Bart's saloon, back room", etc. */
  readonly setting: string;
  /** Optional in-character barker line ("Three open at Bart's table…"). */
  readonly barker?: string;
}

export interface RdcPlatformEncounterReply {
  readonly schema: typeof RDC_PLATFORM_ENCOUNTER_SCHEMA;
  readonly platformId: string;
  readonly ghostId: string;
  readonly accept: boolean;
  readonly reasoning: string;
  /**
   * Math school assigned to this ghost on first sit (RFC-0018). Sent on
   * accept so the orchestrator can show the school on the overlay; the
   * identifier ("Hellmuth", "Sklansky", etc.) — the orchestrator looks
   * up the flavour name locally.
   */
  readonly mathSchool?:
    | "Sklansky"
    | "Chen"
    | "Harrington"
    | "GTO"
    | "Exploitative"
    | "ICM"
    | "Hellmuth";
}

/**
 * Platform exit — orchestrator notifies the agent that they've been
 * released from a platform (ran out of chips, chose to leave, or were
 * kicked). The agent's executor flips game-mode off and resumes the
 * social cascade with the same slider profile.
 */
export interface RdcPlatformExit {
  readonly schema: typeof RDC_PLATFORM_EXIT_SCHEMA;
  readonly platformId: string;
  readonly ghostId: string;
  /** Why they left — for memory + reasoning context next time. */
  readonly reason: "left-by-choice" | "busted-out" | "table-broke";
  readonly finalBalance: number;
}

export interface RdcPokerOutcome {
  readonly schema: typeof RDC_POKER_OUTCOME_SCHEMA;
  readonly tableId: string;
  readonly ghostId: string;
  readonly handNumber: number;
  readonly netChange: number;
  readonly won: boolean;
  /** What the agent showed (if applicable). */
  readonly finalHand?: string;
  readonly opponents: ReadonlyArray<string>;
  /** Full structured replay for memory persistence. */
  readonly handReplay: import("@aie-matrix/ghost-rdc-poker").GameState;
}
