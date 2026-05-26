/**
 * One poker hand, end to end.
 *
 * Holds the engine state, dispatches turns to agents over A2A, validates
 * actions against `getAvailableActions`, and emits intermediate state
 * events to the orchestrator's SSE stream so the overlay can render
 * live.
 *
 * Hole cards are redacted per-recipient before each turn dispatch — the
 * brain only ever sees its own cards.
 */

import {
  applyAction,
  createNewHand,
  evaluateHand,
  getAvailableActions,
  type AvailableActions,
  type GameState,
  type Player,
  type PlayerAction,
} from "@aie-matrix/ghost-rdc-poker";

import type { Client } from "@a2a-js/sdk/client";

import { sendDataAndAwaitReply } from "./agent-client.js";

/**
 * Public reference for one seated agent. The orchestrator already
 * has the agent's A2A client (cached); the runner just needs a way
 * to dispatch.
 */
/**
 * A player at the table. RFC-0019 Barnacle Protocol introduces a
 * `decide` callback path so the session can call brains in-process
 * instead of going A2A-to-self once per turn. Legacy callers
 * (orchestrator-driven flow) still pass `client` and route via A2A.
 *
 * Exactly one of `client` or `decide` must be set. `decide` wins if
 * both are present.
 */
export interface SeatedAgent {
  readonly ghostId: string;
  readonly displayName: string;
  /** Legacy path — A2A round-trip to a separate per-ghost process. */
  readonly client?: Client;
  /** Direct-call path — used by the in-session table driver. The
   *  function receives the same payload that would otherwise be the
   *  body of an `aie-matrix.rdc.poker.turn.v1` A2A message; returns
   *  the reply data part (action / amount / reasoning / tableTalk).
   *  Throws on brain failure (caught by `runOneHand`). */
  readonly decide?: (turnPayload: Record<string, unknown>) => Promise<
    Record<string, unknown> | null
  >;
  /**
   * Persistent chip stack the player brings to the hand. When set, the
   * runner uses this instead of `opts.buyIn` — that's how chip stacks
   * carry across hands (true poker, not per-hand sit-and-go reset).
   * Omit for legacy callers and the runner falls back to `opts.buyIn`.
   */
  readonly chipStack?: number;
}

export interface TableRunnerOptions {
  readonly tableId: string;
  readonly seats: ReadonlyArray<SeatedAgent>;
  readonly buyIn: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  /** Called after every applied action — overlay state stream lives off this. */
  readonly onStateChange?: (event: TableRunnerEvent) => void;
  /**
   * Map<ghostId, opponent-reads-from-memory>. Looked up once at
   * hand-start by the orchestrator (Neo4j read) and passed forward
   * to each turn dispatch so the brain consults real recall, not just
   * an in-process cache.
   */
  readonly opponentReadsByGhost?: ReadonlyMap<string, ReadonlyArray<string>>;
  /**
   * Hellmuth animal-type assignment for this table.
   * `animalsByGhostId` is the source of truth; `animalsByName` is the
   * displayName-keyed shape that gets sent to the agent's brain prompt.
   */
  readonly animalsByGhostId?: ReadonlyMap<
    string,
    "mouse" | "lion" | "jackal" | "elephant" | "eagle"
  >;
  readonly animalsByName?: Readonly<
    Record<string, "mouse" | "lion" | "jackal" | "elephant" | "eagle">
  >;
  /**
   * Skill tier per seated ghost (RFC-0018). Forwarded to the agent on
   * every poker.turn so the brain can tier-gate its math block. Tiers
   * may change mid-table (Journeyman → Veteran at hand #50); the
   * orchestrator rebuilds this map between hands.
   */
  readonly tierByGhostId?: ReadonlyMap<
    string,
    "Greenhorn" | "Journeyman" | "Veteran" | "Eagle"
  >;
}

export type TableRunnerEvent =
  | { readonly kind: "hand-start"; readonly state: GameState }
  | {
      readonly kind: "turn-dispatched";
      readonly state: GameState;
      readonly toGhostId: string;
    }
  | {
      readonly kind: "turn-applied";
      readonly state: GameState;
      readonly action: PlayerAction;
      readonly reasoning: string;
      readonly tableTalk: string;
      /**
       * Addressee parsed from the speaker's `@<Name>:` prefix in
       * tableTalk, or `null` if the speech was general (no @ prefix).
       */
      readonly tableTalkTo: string | null;
      /**
       * Best 5-card hand the actor currently holds (their hole cards
       * plus the community cards), formatted like "Full House, Kings
       * full of Twos" or "Pair of Aces". Null when the actor folded
       * (their hand is mucked) or when hole cards aren't yet dealt.
       * Spectator-only — used to annotate action lines in the
       * commentary feed; never sent to the agent itself.
       */
      readonly handDescription: string | null;
    }
  | { readonly kind: "phase-change"; readonly state: GameState }
  | {
      readonly kind: "hand-complete";
      readonly state: GameState;
      readonly handReplay: GameState;
    };

/**
 * Run a single hand. Returns the final state (winners + chip stacks).
 *
 * The runner does NOT settle ledger credits — that's the orchestrator's
 * job after this returns. It only drives the engine + agents.
 */
export async function runOneHand(
  opts: TableRunnerOptions,
): Promise<GameState> {
  if (opts.seats.length < 2) {
    throw new Error(`runOneHand needs at least 2 seats; got ${opts.seats.length}`);
  }

  const players: Player[] = opts.seats.map((s, i) => ({
    id: s.ghostId,
    name: s.displayName,
    type: "agent" as const,
    seatIndex: i,
    // Carry the seat's persistent chipStack across hands. Falls back
    // to opts.buyIn only for legacy callers that haven't migrated
    // (tests, one-shot scripts).
    chipStack: s.chipStack ?? opts.buyIn,
    holeCards: null,
    currentBet: 0,
    totalBetThisRound: 0,
    isFolded: false,
    isAllIn: false,
    isSittingOut: false,
    isDealer: false,
    isSmallBlind: false,
    isBigBlind: false,
  }));

  let state = createNewHand(players, 0, {
    small: opts.smallBlind,
    big: opts.bigBlind,
  });

  opts.onStateChange?.({ kind: "hand-start", state });

  let lastPhase = state.phase;
  let safetyTurns = 200;
  // Per-hand running transcript of agent table talk. Kept in flight
  // order so the next-up agent can read what's been said and respond
  // in character. `toName` is the addressee parsed from the speaker's
  // `@<Name>:` prefix; null for general table talk.
  const tableTalk: Array<{
    fromName: string;
    text: string;
    toName: string | null;
  }> = [];

  // Display names of everyone seated — used to recognise @-prefix
  // addressees against the table's actual roster.
  const seatedNames = opts.seats.map((s) => s.displayName);

  while (state.phase !== "hand-complete" && safetyTurns-- > 0) {
    const actorIdx = state.currentPlayerIndex;
    if (actorIdx < 0) break;
    const actor = state.players[actorIdx]!;
    const seat = opts.seats.find((s) => s.ghostId === actor.id);
    if (!seat) {
      throw new Error(`no seat for player ${actor.id}`);
    }
    const available = getAvailableActions(state, actor.id);
    if (!hasAnyAction(available)) {
      // Shouldn't happen since the engine moves past blocked seats, but
      // guard anyway.
      break;
    }

    const redactedForAgent = redactForRecipient(state, actor.id);

    // Overlay (spectator) sees the FULL state including all hole cards;
    // agents only see their own redacted view. Two different streams
    // of truth: integrity for the brain, transparency for the audience.
    opts.onStateChange?.({
      kind: "turn-dispatched",
      state,
      toGhostId: actor.id,
    });

    const turnPayload: Record<string, unknown> = {
      schema: "aie-matrix.rdc.poker.turn.v1",
      tableId: opts.tableId,
      ghostId: actor.id,
      gameState: redactedForAgent,
      availableActions: available,
      recentTableTalk: tableTalk.slice(-12),
      opponentReads: opts.opponentReadsByGhost?.get(actor.id) ?? [],
      myAnimalType: opts.animalsByGhostId?.get(actor.id),
      tableAnimalTypes: opts.animalsByName,
      skillTier: opts.tierByGhostId?.get(actor.id),
    };
    let reply: Record<string, unknown> | null;
    if (seat.decide) {
      // RFC-0019 — direct-call path. Same process; no A2A round-trip.
      reply = await seat.decide(turnPayload);
    } else if (seat.client) {
      reply = await sendDataAndAwaitReply(seat.client, turnPayload, {
        timeoutMs: 30_000,
      });
    } else {
      throw new Error(
        `seat for ${actor.id} has neither client nor decide — runner cannot dispatch`,
      );
    }

    if (!reply) {
      throw new Error(`agent ${actor.id} returned no reply on turn`);
    }

    const action = parseAction(reply, actor.id, available);
    state = applyAction(state, action);

    const rawSaid = typeof reply.tableTalk === "string" ? reply.tableTalk.trim() : "";
    const parsed = parseSpeechAddressee(rawSaid, seatedNames);
    if (parsed.text.length > 0) {
      tableTalk.push({
        fromName: actor.name,
        text: parsed.text,
        toName: parsed.to,
      });
    }

    // Spectator hand description for the commentary feed. Skipped for
    // folds — a mucked hand stays mucked. Looked up against the
    // post-applyAction state so chip changes don't matter.
    let handDescription: string | null = null;
    if (action.action !== "fold") {
      const playerNow = state.players.find((p) => p.id === actor.id);
      if (
        playerNow &&
        playerNow.holeCards &&
        playerNow.holeCards.length === 2
      ) {
        try {
          handDescription = evaluateHand(
            playerNow.holeCards,
            state.communityCards,
          ).description;
        } catch {
          handDescription = null;
        }
      }
    }

    opts.onStateChange?.({
      kind: "turn-applied",
      state,
      action,
      reasoning: typeof reply.reasoning === "string" ? reply.reasoning : "",
      tableTalk: parsed.text,
      tableTalkTo: parsed.to,
      handDescription,
    });

    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      if (state.phase !== "hand-complete") {
        opts.onStateChange?.({ kind: "phase-change", state });
      }
    }
  }

  opts.onStateChange?.({
    kind: "hand-complete",
    state,
    handReplay: state,
  });

  return state;
}

/**
 * Parse a `@<Name>: <text>` prefix out of agent speech.
 *
 * If the leading `@<Name>` matches a player at the table (case-
 * insensitive), returns `{to: <Name>, text: <rest>}`. Otherwise the
 * speech is treated as general table-talk and the original text is
 * preserved verbatim.
 */
function parseSpeechAddressee(
  raw: string,
  seatedNames: ReadonlyArray<string>,
): { to: string | null; text: string } {
  if (raw.length === 0) return { to: null, text: "" };
  const m = raw.match(/^@\s*([^:]+?)\s*:\s*(.+)$/s);
  if (!m) return { to: null, text: raw };
  const candidate = m[1]!.trim();
  const text = m[2]!.trim();
  const matched = seatedNames.find(
    (n) => n.toLowerCase() === candidate.toLowerCase(),
  );
  if (!matched) {
    // The brain referenced a name that isn't at the table — drop the
    // prefix and treat as general talk so we don't silently mislabel
    // who's being addressed.
    return { to: null, text: raw };
  }
  return { to: matched, text };
}

function hasAnyAction(a: AvailableActions): boolean {
  return a.canFold || a.canCheck || a.canCall || a.canRaise || a.canAllIn;
}

/**
 * Strip other players' hole cards before sending to a recipient.
 * The recipient sees their own hand and the public board only.
 */
function redactForRecipient(state: GameState, recipientId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === recipientId
        ? p
        : { ...p, holeCards: p.isFolded ? null : null },
    ),
    // Don't leak the deck either.
    deck: [],
  };
}

function parseAction(
  reply: Record<string, unknown>,
  expectedGhostId: string,
  available: AvailableActions,
): PlayerAction {
  const ghostId = String(reply.ghostId ?? "");
  if (ghostId !== expectedGhostId) {
    throw new Error(
      `agent reply ghostId mismatch: expected ${expectedGhostId}, got ${ghostId}`,
    );
  }
  const actionStr = String(reply.action ?? "");
  const amount = typeof reply.amount === "number" ? reply.amount : 0;

  // Defense-in-depth: re-check legality. The agent's poker brain also
  // coerces; this is the orchestrator's last line.
  let action: PlayerAction["action"];
  let resolvedAmount = 0;
  switch (actionStr) {
    case "fold":
      if (!available.canFold) throw new Error("fold not available");
      action = "fold";
      break;
    case "check":
      if (!available.canCheck) throw new Error("check not available");
      action = "check";
      break;
    case "call":
      if (!available.canCall && !available.canAllIn) {
        throw new Error("call not available");
      }
      action = "call";
      resolvedAmount = available.callAmount;
      break;
    case "raise":
      if (!available.canRaise) throw new Error("raise not available");
      action = "raise";
      resolvedAmount = Math.max(
        available.minRaise,
        Math.min(available.maxRaise, amount),
      );
      break;
    case "all-in":
      if (!available.canAllIn) throw new Error("all-in not available");
      action = "all-in";
      resolvedAmount = available.allInAmount;
      break;
    default:
      throw new Error(`unknown action: ${actionStr}`);
  }

  return {
    playerId: expectedGhostId,
    action,
    amount: resolvedAmount,
    timestamp: Date.now(),
  };
}
