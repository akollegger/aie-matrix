import { Context, Effect, Layer } from "effect";
import { Temporal } from "@js-temporal/polyfill";
import { WORLD_TIMEZONE } from "@aie-matrix/shared-types";
import type { ScheduleEvent } from "./CalendarEvent.js";
import { toScheduledEvent, todayOccurrences, firedKey } from "./CalendarEvent.js";
import type { ScheduledEvent } from "./CalendarEvent.js";
import { dispatchCalendarCommand } from "./CalendarCommandDispatcher.js";
import { makeSchedulerContext } from "@aie-matrix/shared-types";
import { LeaderboardService } from "../LeaderboardService.js";
import type { LeaderboardServiceOps } from "../LeaderboardService.js";

// ── Service interface ────────────────────────────────────────────────────────

export interface WorldCalendarService {
  /** Returns today's remaining upcoming occurrences, sorted by time, capped at limit. */
  upcomingEvents(limit: number): Effect.Effect<ScheduledEvent[]>;
  /** Execute due enter/exit commands for today's occurrences. */
  tick(): Effect.Effect<void>;
}

export const WorldCalendarService = Context.GenericTag<WorldCalendarService>(
  "@aie-matrix/world-api/WorldCalendarService",
);

// ── Command dispatch helpers ─────────────────────────────────────────────────

const SCHEDULER_CTX = makeSchedulerContext();

function runCommand(
  command: string,
  phase: "enter" | "exit",
  leaderboardSvc: LeaderboardServiceOps | null,
): Effect.Effect<void> {
  const dispatched = leaderboardSvc
    ? dispatchCalendarCommand(command, SCHEDULER_CTX).pipe(
        Effect.provideService(LeaderboardService, leaderboardSvc),
      )
    : dispatchCalendarCommand(command, SCHEDULER_CTX).pipe(
        Effect.provideService(LeaderboardService, {
          init: () => Effect.void,
          listLeaderboards: () => Effect.succeed([]),
          getLeaderboard: () => Effect.die("LeaderboardService not available"),
          finalizeLeaderboards: () => Effect.logWarning("[calendar] LeaderboardService not wired — finalize-leaderboards skipped").pipe(Effect.asVoid),
        }),
      );
  return dispatched.pipe(
    Effect.catchTag("NoActorOrigin", (e) =>
      Effect.logWarning(`[calendar] ${phase} command requires actor position — skipped: ${e.command}`),
    ),
    Effect.catchTag("UnknownCalendarCommand", (e) =>
      Effect.logWarning(`[calendar] unknown ${phase} command — skipped: ${e.command}`),
    ),
    Effect.catchTag("CommandNotYetImplemented", (e) =>
      Effect.logWarning(`[calendar] ${phase} command not yet implemented — skipped: ${e.command}`),
    ),
  );
}

function runCommands(
  commands: readonly string[],
  phase: "enter" | "exit",
  leaderboardSvc: LeaderboardServiceOps | null,
): Effect.Effect<void> {
  return Effect.forEach(commands, (cmd) => runCommand(cmd, phase, leaderboardSvc), { discard: true });
}

// ── Service factory ──────────────────────────────────────────────────────────

export function makeWorldCalendarLayer(
  events: ScheduleEvent[],
  leaderboardSvc?: LeaderboardServiceOps,
): Layer.Layer<WorldCalendarService, never, LeaderboardService> {
  if (leaderboardSvc !== undefined) {
    return Layer.succeed(
      WorldCalendarService,
      makeWorldCalendarService(events, leaderboardSvc),
    );
  }
  return Layer.effect(
    WorldCalendarService,
    Effect.gen(function* () {
      const svc = yield* LeaderboardService;
      return makeWorldCalendarService(events, svc);
    }),
  );
}

export function makeWorldCalendarService(
  events: ScheduleEvent[],
  leaderboardSvc: LeaderboardServiceOps | null = null,
): WorldCalendarService {
  // Fired-event tracking uses an in-memory Set keyed by firedKey(id, date, n).
  // This prevents re-firing within a single process lifetime (including same-day
  // restarts that happen fast enough). Full cross-restart idempotency requires
  // Neo4j persistence (CALENDAR_EVENT_ID_UNIQUE_CONSTRAINT is in place); that
  // integration is deferred — see plan.md Phase F coverage gap documentation.
  const fired = new Set<string>();

  function nowAndToday(): { now: Temporal.ZonedDateTime; today: Temporal.PlainDate } {
    const now = Temporal.Now.zonedDateTimeISO(WORLD_TIMEZONE);
    return { now, today: now.toPlainDate() };
  }

  return {
    upcomingEvents(limit: number) {
      return Effect.sync(() => {
        const { now, today } = nowAndToday();
        const upcoming: ScheduledEvent[] = [];

        for (const event of events) {
          for (const { zdt } of todayOccurrences(event, today)) {
            // Include if not yet started (still in the future or just reached)
            if (Temporal.ZonedDateTime.compare(zdt, now) >= 0) {
              upcoming.push({ ...toScheduledEvent(event), startsAt: zdt.toString({ timeZoneName: "never", calendarName: "never" }) });
              break; // only the next upcoming occurrence per event template
            }
          }
        }

        return upcoming
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, limit);
      });
    },

    tick() {
      return Effect.gen(function* () {
        const { now, today } = nowAndToday();

        for (const event of events) {
          for (const { zdt, n } of todayOccurrences(event, today)) {
            const enterKey = firedKey(event.id, today, n);
            const exitKey = `${enterKey}@end`;

            // ── Enter ──────────────────────────────────────────────────────
            if (Temporal.ZonedDateTime.compare(zdt, now) <= 0 && !fired.has(enterKey)) {
              yield* runCommands(event.enterCommands, "enter", leaderboardSvc);
              fired.add(enterKey);
              yield* Effect.logDebug(`[calendar] started: ${enterKey}`);
            }

            // ── Exit ───────────────────────────────────────────────────────
            if (event.duration > 0 && fired.has(enterKey) && !fired.has(exitKey)) {
              const endZdt = zdt.add({ minutes: event.duration });
              if (Temporal.ZonedDateTime.compare(endZdt, now) <= 0) {
                yield* runCommands(event.exitCommands, "exit", leaderboardSvc);
                fired.add(exitKey);
                yield* Effect.logDebug(`[calendar] ended: ${exitKey}`);
              }
            }
          }
        }
      });
    },
  };
}
