/**
 * RFC-0019 — in-session table auto-loop.
 *
 * Per-process driver for one poker table. Watches `ActiveTable` for
 * `size >= minPlayers`, deals a hand, settles to the ledger, persists
 * memory, runs reflection every 3 hands, signals `BarnacleComplete`
 * for any leavers, and loops. Mirrors the orchestrator's
 * `runPlatformLoop` shape but uses direct-call brains (`decide`) and
 * `ActiveTable`'s seat roster instead of the orchestrator's Platform
 * + per-ghost A2A clients.
 *
 * One instance per session process — call `startSessionLoop` once at
 * startup after `setActiveTable`. Returns a handle whose `stop()` halts
 * the loop after the current hand completes.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Ledger } from "@aie-matrix/ghost-rdc-ledger";

import { assignAnimals } from "./animal-assignment.js";
import { buildInProcessDecide } from "./decide-in-process.js";
import { sendBarnacleComplete } from "./executor.js";
import type { AnimalType } from "./hellmuth-profile.js";
import { personaFromSliders } from "./persona-from-sliders.js";
import { invokeReflectionBrain } from "./reflect-brain.js";
import {
  fetchOpponentReads,
  persistHand,
} from "./memory-writer.js";
import { runOneHand, type SeatedAgent, type TableRunnerEvent } from "./table-runner.js";
import { ActiveTable, type TableSeat } from "./table-state.js";
import { computeTilt } from "./tilt-detector.js";

const REFLECTION_INTERVAL_HANDS = 3;
const INTER_HAND_PAUSE_MS = 4_000;
const SHORT_TABLE_PAUSE_MS = 1_500;
/** How long a BUSTED player has to wait before they can re-buy-in.
 *  Long enough that other ghosts get a chance at the seat first. */
const BUSTED_COOLDOWN_MS = 120_000; // 2 minutes
/** How long a VOLUNTARY leaver waits — shorter, since the seat
 *  freed up isn't a punishment. */
const LEFT_BY_CHOICE_COOLDOWN_MS = 30_000; // 30 seconds
/** How many of a seat's most recent hand outcomes the tilt detector
 *  looks at. 5 = sliding "last orbit" window — enough to spot a real
 *  losing streak, short enough that a couple of wins genuinely
 *  recovers the player out of tilt. */
const RECENT_OUTCOMES_WINDOW = 5;

/**
 * Pick the path for the per-hand audit log (one JSON line per hand).
 *
 *   RDC_HANDS_LOG_PATH       overrides everything
 *   else if RDC_LEDGER_PATH  set, write a sibling file `hands.jsonl`
 *   else                     null (logging disabled — caller no-ops)
 *
 * Logging gated on the same persistence intent as the ledger so a
 * stateless dev run doesn't accidentally leak hands to disk.
 */
function resolveHandsLogPath(): string | null {
  const explicit = process.env.RDC_HANDS_LOG_PATH;
  if (explicit && explicit.length > 0) return explicit;
  const ledger = process.env.RDC_LEDGER_PATH;
  if (ledger && ledger.length > 0) {
    return path.join(path.dirname(ledger), "hands.jsonl");
  }
  return null;
}

/**
 * Lifecycle events the session emits alongside the per-turn
 * `TableRunnerEvent` stream. Mapped onto SSE events by the overlay
 * server (`hand-deal`, `hand-settled`, `seat-released`).
 */
export type SessionLifecycleEvent =
  | {
      readonly kind: "hand-deal";
      readonly tableId: string;
      readonly handNumber: number;
      readonly seats: ReadonlyArray<{
        readonly ghostId: string;
        readonly displayName: string;
        readonly role: "outlaw" | "marshall";
        /** Persistent chips in front of this player BEFORE the hand
         *  starts. Spectator-facing — this is what the overlay should
         *  render alongside the seat name so the user watches stacks
         *  rise and fall across hands. */
        readonly chipStack: number;
        /** True if the seat is currently in a tilted state. Overlay
         *  may render a TILTED badge so spectators can see who's
         *  unraveling. */
        readonly tilted: boolean;
      }>;
      readonly animals: Readonly<Record<string, string>>;
      readonly tiers: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "hand-settled";
      readonly tableId: string;
      readonly handNumber: number;
      readonly netChanges: Readonly<Record<string, number>>;
      /** Updated chip stacks per ghost AFTER the hand. The overlay
       *  reads this to render the new stack values without polling. */
      readonly chipStacks: Readonly<Record<string, number>>;
    }
  | {
      readonly kind: "seat-released";
      readonly ghostId: string;
      readonly displayName: string;
      readonly reason: "busted-out" | "left-by-choice";
      readonly narrative?: string;
      /** Chips remaining at the moment of release (0 for bust-outs).
       *  Cashed out to the Cyphers ledger before the seat is cleared. */
      readonly cashOut?: number;
    };

export interface SessionLoopOptions {
  readonly activeTable: ActiveTable;
  readonly ledger: Ledger;
  /**
   * Per-turn table-runner stream wrapped with the current hand's tableId
   * so spectators can correlate `hand-start` / `turn-applied` /
   * `phase-change` / `hand-complete` events back to a specific hand.
   */
  readonly onTableEvent?: (envelope: {
    readonly tableId: string;
    readonly event: TableRunnerEvent;
  }) => void;
  /** Lifecycle events surrounding the per-turn stream (deal, settle, release). */
  readonly onLifecycle?: (event: SessionLifecycleEvent) => void;
  /**
   * Memory writes go to the same Neo4j peppers uses. We pull
   * connection creds from env on demand (same as the orchestrator did).
   */
  readonly persistMemory?: boolean;
}

export interface SessionLoopHandle {
  readonly stop: () => void;
}

function slog(kind: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ kind, ...fields }));
}

function swarn(kind: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ kind, ...fields }));
}

export function startSessionLoop(opts: SessionLoopOptions): SessionLoopHandle {
  const table = opts.activeTable;
  const ledger = opts.ledger;
  let stopped = false;
  let handCount = 0;

  /** Per-seat balance at last reflection — used to compute swing. */
  const lastReflectionBalance = new Map<string, number>();

  async function dealOneHand(seated: TableSeat[]): Promise<void> {
    // 1. Eligibility: each seat already paid the buy-in on sitdown,
    //    so the chipStack carries across hands. Bust threshold is
    //    strict zero — a short stack with any chips at all is allowed
    //    to play (they can post a partial blind or jam all-in).
    //    "When they run out of chips they have to leave."
    const eligibleSeats: TableSeat[] = [];
    for (const seat of seated) {
      if (seat.chipStack <= 0) {
        swarn("rdc-poker-session.busted-out", {
          ghostId: seat.ghostId,
          chipStack: seat.chipStack,
        });
        await releasePlayer(seat, "busted-out");
        continue;
      }
      eligibleSeats.push(seat);
    }
    if (eligibleSeats.length < table.config.minPlayers) {
      // No buy-ins were debited this turn; nothing to refund.
      return;
    }

    // 2. Assign Hellmuth animals per-table this hand. `assignAnimals`
    //    returns a Map<ghostId, AnimalType>. Quick uniform fitness for
    //    v1 — full slider-derived scoring lands in a refinement.
    const animalsByGhostId: ReadonlyMap<string, AnimalType> = assignAnimals(
      eligibleSeats.map((s) => ({
        ghostId: s.ghostId,
        fitness: { mouse: 1, lion: 1, jackal: 1, elephant: 1, eagle: 1 },
      })),
    );
    const animalsByName: Record<string, AnimalType> = {};
    for (const seat of eligibleSeats) {
      const animal = animalsByGhostId.get(seat.ghostId);
      if (animal) {
        animalsByName[seat.displayName] = animal;
        // Mirror onto the live seat so the decide-builder sees it.
        (seat as TableSeat & { animalType?: AnimalType }).animalType = animal;
      }
    }

    // 3. Opponent reads from memory (best-effort).
    const opponentReadsByGhost = new Map<string, string[]>();
    if (opts.persistMemory) {
      try {
        for (const seat of eligibleSeats) {
          const others = eligibleSeats
            .filter((s) => s.ghostId !== seat.ghostId)
            .map((s) => s.ghostId);
          opponentReadsByGhost.set(
            seat.ghostId,
            [...(await fetchOpponentReads(seat.ghostId, others))],
          );
        }
      } catch (err) {
        swarn("rdc-poker-session.opponent-reads-failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 4. Skill tiers (current snapshot).
    const tierByGhostId = new Map(
      eligibleSeats.map((s) => [
        s.ghostId,
        ledger.getSkillProfile(s.ghostId).tier,
      ]),
    );

    // 5. Build SeatedAgent[] with the direct-call decide path. Carry
    //    each seat's persistent chipStack so the runner doesn't reset
    //    everyone to opts.buyIn (which would erase the across-hand
    //    drama the user came here to watch).
    const runnerSeats: SeatedAgent[] = eligibleSeats.map((s) => ({
      ghostId: s.ghostId,
      displayName: s.displayName,
      decide: buildInProcessDecide(table, s.ghostId),
      chipStack: s.chipStack,
    }));

    // 6. Drive the hand.
    const tableId = randomUUID();
    table.running = true;
    // Spectator: announce the deal before the runner emits hand-start so
    // the overlay can flip to a fresh table view with the seat roster.
    opts.onLifecycle?.({
      kind: "hand-deal",
      tableId,
      handNumber: handCount + 1,
      seats: eligibleSeats.map((s) => ({
        ghostId: s.ghostId,
        displayName: s.displayName,
        role: s.role,
        chipStack: s.chipStack,
        tilted: s.isTilted,
      })),
      animals: Object.fromEntries(
        eligibleSeats
          .map((s) => [s.ghostId, animalsByGhostId.get(s.ghostId)] as const)
          .filter(([, v]) => v !== undefined) as Array<readonly [string, string]>,
      ),
      tiers: Object.fromEntries(
        [...tierByGhostId.entries()].map(([k, v]) => [k, String(v)] as const),
      ),
    });
    // Capture per-turn LLM annotations (reasoning + tableTalk) as
    // the runner emits them. Used by persistHand to write strategy-
    // level audit data alongside the public action sequence — the
    // only place where we can later read back "was Marshal Hops
    // really bluffing or just lucky-mouthed?" The events are pushed
    // in turn order so a positional index into `actions` matches.
    const turnAnnotations: Array<{
      playerId: string;
      action: "fold" | "check" | "call" | "raise" | "all-in";
      amount: number;
      reasoning: string;
      tableTalk: string;
      tableTalkTo: string | null;
    }> = [];

    let finalState;
    try {
      finalState = await runOneHand({
        tableId,
        seats: runnerSeats,
        buyIn: table.config.buyIn,
        smallBlind: table.config.smallBlind,
        bigBlind: table.config.bigBlind,
        opponentReadsByGhost,
        animalsByGhostId,
        animalsByName,
        tierByGhostId,
        onStateChange: (ev) => {
          if (ev.kind === "turn-applied") {
            turnAnnotations.push({
              playerId: ev.action.playerId,
              action: ev.action.action,
              amount: ev.action.amount,
              reasoning: ev.reasoning,
              tableTalk: ev.tableTalk,
              tableTalkTo: ev.tableTalkTo,
            });
          }
          opts.onTableEvent?.({ tableId, event: ev });
        },
      });
    } finally {
      table.running = false;
    }

    // 7. Settle. The pot was awarded inside the engine — the winner's
    //    `chipStack` in finalState reflects their new total. Sync that
    //    back to our persistent seat.chipStack so the next hand starts
    //    from the actual stacks (not a re-bought 100 each). NO ledger
    //    debits/credits per hand — chips only flow Cyphers ↔ table on
    //    buy-in (sit) and cash-out (leave).
    //
    //    Bust detection: if a player ends the hand with 0 chips (lost
    //    a showdown all-in) we release them right after settlement so
    //    the seat opens for the next ghost. Done in a second pass to
    //    avoid mutating `eligibleSeats` while we iterate it.
    const netChanges: Record<string, number> = {};
    const bustedSeats: TableSeat[] = [];
    for (const seat of eligibleSeats) {
      const finalPlayer = finalState.players.find((p) => p.id === seat.ghostId);
      if (!finalPlayer) continue;
      const net = finalPlayer.chipStack - seat.chipStack;
      netChanges[seat.ghostId] = net;
      // Persist the new chip stack on the seat. This is what survives
      // across hands and gives the spectator the up-and-down drama.
      seat.chipStack = finalPlayer.chipStack;
      if (seat.chipStack <= 0) {
        bustedSeats.push(seat);
      }
      const { profile, promoted } = ledger.recordHandPlayed(seat.ghostId);
      if (promoted) {
        slog("rdc-poker-session.tier-promoted", {
          ghostId: seat.ghostId,
          displayName: seat.displayName,
          tier: profile.tier,
          handsPlayed: profile.handsPlayed,
        });
      }
    }

    // 7b. Tilt update. Append this hand's outcome to each seat's
    //     sliding window, then recompute tilt state. Hysteresis
    //     handled inside computeTilt (enter > 0.4, exit < 0.2).
    //     Surfaces on the seat itself; the decision pipeline reads it
    //     per turn on the next hand.
    const tableChipsAfter = table
      .list()
      .reduce((s, x) => s + x.chipStack, 0);
    const seatCountAfter = table.size();
    for (const seat of eligibleSeats) {
      const net = netChanges[seat.ghostId] ?? 0;
      seat.recentOutcomes.push(net > 0 ? "win" : "loss");
      if (seat.recentOutcomes.length > RECENT_OUTCOMES_WINDOW) {
        seat.recentOutcomes.shift();
      }
      // Pull tiltSusceptibility from the persona derivation — drifts
      // with the slider profile so a ghost that became more brittle
      // mid-session can tilt easier.
      const persona = personaFromSliders({
        ghostId: seat.ghostId,
        displayName: seat.displayName,
        state: seat.personality,
        role: seat.role,
      });
      const tilt = computeTilt({
        recentOutcomes: seat.recentOutcomes,
        myChips: seat.chipStack,
        tableChips: tableChipsAfter,
        seatCount: seatCountAfter,
        tiltSusceptibility: persona.tiltSusceptibility,
      });
      if (!seat.isTilted && tilt.shouldEnter) {
        seat.isTilted = true;
        slog("rdc-poker-session.tilt-entered", {
          ghostId: seat.ghostId,
          displayName: seat.displayName,
          effective: tilt.effective,
          lossRate: tilt.lossRate,
          chipStress: tilt.chipStress,
          tiltSusceptibility: persona.tiltSusceptibility,
        });
      } else if (seat.isTilted && tilt.shouldExit) {
        seat.isTilted = false;
        slog("rdc-poker-session.tilt-recovered", {
          ghostId: seat.ghostId,
          displayName: seat.displayName,
          effective: tilt.effective,
        });
      }
    }

    // 7c. Release anyone who busted this hand (showdown all-in losses).
    //     Frees the seat for the next ghost and starts their cooldown.
    for (const seat of bustedSeats) {
      await releasePlayer(
        seat,
        "busted-out",
        `Busted out at ${table.config.setting} — chips: 0.`,
      );
    }

    // 8. Memory persistence (best-effort). Two sinks:
    //    - Neo4j ReasoningTrace per ghost, now annotated with the
    //      LLM's per-turn reasoning + tableTalk (so an audit can read
    //      "raised 18 chips while claiming 6-high" off the graph).
    //    - Local JSONL audit log at .local/hands.jsonl — one record
    //      per hand with the full chronology of holes, board, actions,
    //      reasoning, and tableTalk. Lets a human inspect strategy
    //      retroactively without standing up Neo4j.
    const handId = randomUUID();
    const handRecord = {
      handId,
      handNumber: handCount + 1,
      tableId,
      finalState,
      actions: finalState.actionHistory,
      actionAnnotations: turnAnnotations,
      perGhost: eligibleSeats.map((seat) => {
        const finalPlayer = finalState.players.find((p) => p.id === seat.ghostId);
        const winnerEntry = finalState.winners?.find((w) => w.playerId === seat.ghostId);
        return {
          ghostId: seat.ghostId,
          ghostName: seat.displayName,
          holeCards: finalPlayer?.holeCards ?? [],
          netChange: netChanges[seat.ghostId] ?? 0,
          won: (netChanges[seat.ghostId] ?? 0) > 0,
          finalHandDescription: winnerEntry?.hand?.description ?? null,
        };
      }),
      atIso: new Date().toISOString(),
    } as const;

    // Disk-local audit log — always written when ledger persistence
    // is on (sibling of the Cyphers ledger). Cheap, sync-feel via
    // fire-and-forget; never blocks the deal loop.
    void appendHandAuditLog(handRecord);

    if (opts.persistMemory) {
      try {
        await persistHand(handRecord);
      } catch (err) {
        swarn("rdc-poker-session.memory-persist-failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Spectator: hand-settled (winners, deltas) so the ledger panel
    // refreshes without polling. Includes the updated chipStacks so
    // the overlay can render the new persistent stacks without
    // calling back into the session.
    const chipStacksSnapshot: Record<string, number> = {};
    for (const seat of eligibleSeats) {
      chipStacksSnapshot[seat.ghostId] = seat.chipStack;
    }
    opts.onLifecycle?.({
      kind: "hand-settled",
      tableId,
      handNumber: handCount + 1,
      netChanges,
      chipStacks: chipStacksSnapshot,
    });

    handCount += 1;

    // 9. Reflection every N hands. For each seated player, ask the
    //    reflection brain to decide stick / switch / leave. On "leave",
    //    send BarnacleComplete to the supervisor and release the seat.
    if (handCount % REFLECTION_INTERVAL_HANDS === 0) {
      const seatsAfterSettle = table.list();
      for (const seat of seatsAfterSettle) {
        const currentBalance = ledger.getBalance(seat.ghostId);
        const lastBal = lastReflectionBalance.get(seat.ghostId);
        const net = lastBal === undefined ? 0 : currentBalance - lastBal;
        lastReflectionBalance.set(seat.ghostId, currentBalance);
        try {
          const animal = animalsByGhostId.get(seat.ghostId);
          if (!animal) continue;
          const result = await invokeReflectionBrain({
            state: seat.personality,
            displayName: seat.displayName,
            ghostId: seat.ghostId,
            role: seat.role,
            currentAnimal: animal,
            currentBalance,
            netSinceLastReflection: net,
            handsPlayed: handCount,
            recentOutcomes: [],
          });
          if (result.decision === "leave") {
            slog("rdc-poker-session.reflection-leave", {
              ghostId: seat.ghostId,
              reasoning: result.reasoning,
            });
            await releasePlayer(
              seat,
              "left-by-choice",
              `Played ${handCount} hand${handCount === 1 ? "" : "s"} at ${table.config.setting}; net ${net >= 0 ? "+" : ""}${net} Cyphers. ${result.reasoning}`,
            );
          }
          // "stick" + "switch" are kept as in-table mutations — switch
          // logic (forbid current animal, reassign next hand) is a
          // refinement for phase 6; for now both keep the seat.
        } catch (err) {
          swarn("rdc-poker-session.reflection-brain-error", {
            ghostId: seat.ghostId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  async function releasePlayer(
    seat: TableSeat,
    reason: "busted-out" | "left-by-choice",
    narrative?: string,
  ): Promise<void> {
    // Cash out remaining chips back to the Cyphers ledger BEFORE
    // releasing the seat. A bust-out has 0 chips left so this is a
    // no-op; a voluntary leave converts the table chipStack back
    // into Cyphers. This balances against the buy-in debit done on sit.
    const cashOut = Math.max(0, seat.chipStack);
    if (cashOut > 0) {
      ledger.award(
        seat.ghostId,
        cashOut,
        `poker cash-out from table @ ${table.config.platformId}`,
      );
    }
    // Apply cooldown — bust-outs get a longer cooldown than voluntary
    // leaves (the busted player just lost their stack; let them cool
    // off and let a different ghost get a seat).
    const cooldownMs = reason === "busted-out"
      ? BUSTED_COOLDOWN_MS
      : LEFT_BY_CHOICE_COOLDOWN_MS;
    table.setCooldown(seat.ghostId, cooldownMs);

    table.release(seat.ghostId);
    lastReflectionBalance.delete(seat.ghostId);
    slog("rdc-poker-session.released", {
      ghostId: seat.ghostId,
      sessionId: seat.barnacleSessionId,
      reason,
      cashOut,
      cooldownMs,
    });
    opts.onLifecycle?.({
      kind: "seat-released",
      ghostId: seat.ghostId,
      displayName: seat.displayName,
      reason,
      cashOut,
      ...(narrative !== undefined ? { narrative } : {}),
    });
    // Tell the supervisor — it will respawn the ghost + resume peppers.
    // Best-effort: if the network is down, the supervisor's heartbeat
    // poller will eventually treat the session as crashed and force
    // the respawn anyway.
    void sendBarnacleComplete(seat.supervisorA2A, {
      sessionId: seat.barnacleSessionId,
      ghostId: seat.ghostId,
      narrative,
    });
  }

  async function loop(): Promise<void> {
    while (!stopped) {
      const seated = table.list();
      if (seated.length < table.config.minPlayers) {
        await sleep(SHORT_TABLE_PAUSE_MS);
        continue;
      }
      try {
        await dealOneHand([...seated]);
      } catch (err) {
        swarn("rdc-poker-session.deal-hand-error", {
          message: err instanceof Error ? err.message : String(err),
        });
      }
      await sleep(INTER_HAND_PAUSE_MS);
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Append a one-line JSON record to the per-hand audit log. The path
   * is derived from `RDC_HANDS_LOG_PATH` (if set) or co-located with
   * the Cyphers ledger so disk inspection finds them together.
   *
   * Each line is a self-contained record: hand id, hand number, table,
   * timestamp, the public action sequence with each turn's reasoning +
   * tableTalk inline, the dealt board, and per-ghost holes + outcome.
   *
   * Fire-and-forget — errors are logged but never block the deal
   * loop. If the directory doesn't exist we'll auto-create it.
   */
  async function appendHandAuditLog(
    record: import("./memory-writer.js").PokerHandRecord,
  ): Promise<void> {
    const logPath = resolveHandsLogPath();
    if (!logPath) return;
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      // Build a flat per-action sequence by zipping action history
      // with the captured annotations.
      const annotations = record.actionAnnotations ?? [];
      const actionRecords = record.actions.map((a, i) => {
        const player = record.finalState.players.find((p) => p.id === a.playerId);
        const ann = annotations[i];
        const aligned = ann && ann.playerId === a.playerId ? ann : null;
        return {
          actor: player?.name ?? a.playerId.slice(0, 8),
          actorId: a.playerId,
          action: a.action,
          amount: a.amount,
          atMs: a.timestamp,
          reasoning: aligned?.reasoning ?? null,
          tableTalk: aligned?.tableTalk || null,
          tableTalkTo: aligned?.tableTalkTo ?? null,
        };
      });
      const line = JSON.stringify({
        handId: record.handId,
        handNumber: record.handNumber,
        tableId: record.tableId,
        atIso: record.atIso,
        communityCards: record.finalState.communityCards,
        actions: actionRecords,
        perGhost: record.perGhost.map((g) => ({
          ghostId: g.ghostId,
          name: g.ghostName,
          holeCards: g.holeCards,
          netChange: g.netChange,
          won: g.won,
          finalHand: g.finalHandDescription,
        })),
      });
      await fs.appendFile(logPath, line + "\n", "utf8");
    } catch (err) {
      swarn("rdc-poker-session.hands-audit-log-failed", {
        message: err instanceof Error ? err.message : String(err),
        path: logPath,
      });
    }
  }

  // Kick off the loop. It's resilient — if seats drop below minPlayers
  // it just waits; new handoffs that fill the table will be picked up
  // on the next iteration.
  void loop();
  slog("rdc-poker-session.loop-started", {
    platformId: table.config.platformId,
    minPlayers: table.config.minPlayers,
    capacity: table.config.capacity,
  });

  return {
    stop: () => {
      stopped = true;
    },
  };
}
