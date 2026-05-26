/**
 * RFC-0019 — in-process brain-call builder.
 *
 * Returns a function that, given a poker.turn payload (the same shape
 * the legacy A2A flow used), runs the poker brain directly in the
 * current process and returns the reply data part. Used by the
 * in-session auto-loop so we don't A2A-self-call once per turn.
 *
 * Mirrors the inputs that `executor.handlePokerTurn` would assemble
 * from an A2A request, but pulls per-ghost state from `ActiveTable`
 * instead of the legacy per-ghost `ghosts` map.
 */
import type {
  AvailableActions,
  GameState,
} from "@aie-matrix/ghost-rdc-poker";

import type { AnimalType } from "./hellmuth-profile.js";
import type { MathSchool } from "./math-schools.js";
import { invokePokerBrain } from "./poker-brain.js";
import { personaFromSliders } from "./persona-from-sliders.js";
import type { ActiveTable } from "./table-state.js";
import type { SkillTier } from "@aie-matrix/ghost-rdc-ledger";

interface TurnPayload {
  readonly schema: string;
  readonly tableId: string;
  readonly ghostId: string;
  readonly gameState: GameState;
  readonly availableActions: AvailableActions;
  readonly recentTableTalk?: ReadonlyArray<{
    readonly fromName: string;
    readonly text: string;
    readonly toName?: string | null;
  }>;
  readonly opponentReads?: ReadonlyArray<string>;
  readonly myAnimalType?: AnimalType;
  readonly tableAnimalTypes?: Readonly<Record<string, AnimalType>>;
  readonly skillTier?: SkillTier;
}

/**
 * Build a `decide` callback (the shape `SeatedAgent.decide` wants).
 *
 * The closure captures `activeTable` + the seated player's `ghostId`
 * so it can re-read the seat (persona may drift between hands via
 * reflection). On invocation it derives persona from current sliders,
 * calls `invokePokerBrain`, and returns the reply formatted like the
 * legacy A2A reply (action / amount / reasoning / tableTalk).
 *
 * Throws if the seat is gone (released between turn-dispatch and now)
 * — the caller (`runOneHand`) treats throws as a brain error and may
 * default-fold.
 */
export function buildInProcessDecide(
  activeTable: ActiveTable,
  ghostId: string,
): (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null> {
  return async (rawPayload) => {
    const payload = rawPayload as unknown as TurnPayload;
    const seat = activeTable.getSeat(ghostId);
    if (!seat) {
      throw new Error(`in-process decide: ghost ${ghostId} no longer seated`);
    }
    const persona = personaFromSliders({
      ghostId: seat.ghostId,
      displayName: seat.displayName,
      state: seat.personality,
      role: seat.role,
    });
    const decision = await invokePokerBrain({
      persona,
      gameState: payload.gameState,
      availableActions: payload.availableActions,
      ghostId: seat.ghostId,
      opponentReads: payload.opponentReads,
      recentTableTalk: payload.recentTableTalk,
      myAnimalType: payload.myAnimalType ?? seat.animalType,
      tableAnimalTypes: payload.tableAnimalTypes,
      mathSchool: seat.mathSchool as MathSchool,
      skillTier: payload.skillTier,
      // Tilt state is read off the seat live. session-loop flips
      // `isTilted` between hands; the per-turn roll happens inside
      // the pipeline so a tilted player can hold it together on one
      // turn and crack on the next.
      tilt: {
        tilted: seat.isTilted,
        tiltSusceptibility: persona.tiltSusceptibility,
      },
    });
    // Shape matches the legacy `RdcPokerTurnReply` so `runOneHand` can
    // consume it identically whether the path was A2A or direct.
    return {
      schema: "aie-matrix.rdc.poker.turn.v1",
      tableId: payload.tableId,
      ghostId: seat.ghostId,
      action: decision.action,
      amount: decision.amount,
      reasoning: decision.reasoning,
      confidence: decision.confidence,
      tableTalk: decision.tableTalk ?? "",
    };
  };
}
