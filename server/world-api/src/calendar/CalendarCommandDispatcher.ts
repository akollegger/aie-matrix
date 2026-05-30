import { Data, Effect } from "effect";
import type { SchedulerContext } from "@aie-matrix/shared-types";

export class NoActorOrigin extends Data.TaggedError("NoActorOrigin")<{
  readonly command: string;
}> {}

export class UnknownCalendarCommand extends Data.TaggedError("UnknownCalendarCommand")<{
  readonly command: string;
}> {}

export class CommandNotYetImplemented extends Data.TaggedError("CommandNotYetImplemented")<{
  readonly command: string;
}> {}

/**
 * Dispatch a single calendar command string with SchedulerContext (IC-CAL-003).
 *
 * Registered commands: claim, yield, raffle (active), activate/deactivate (stubs — RFC-0006).
 * Movement commands (go, traverse) → NoActorOrigin.
 * Unrecognised commands → UnknownCalendarCommand.
 *
 * The scheduler calls this for each enterCommand / exitCommand and logs non-fatal
 * errors at warn level, continuing to the next command.
 */
export function dispatchCalendarCommand(
  command: string,
  _context: SchedulerContext,
): Effect.Effect<void, NoActorOrigin | UnknownCalendarCommand | CommandNotYetImplemented> {
  const verb = command.trim().split(/\s+/)[0]?.toLowerCase();

  switch (verb) {
    case "go":
    case "traverse":
      return Effect.fail(new NoActorOrigin({ command }));

    case "claim":
    case "yield":
    case "raffle":
      // Active commands — currently no-op stubs; will be wired to real handler
      // Effects once the full CommandExecutor refactor lands (separate future RFC).
      return Effect.logDebug(`[calendar] dispatched: ${command}`).pipe(
        Effect.asVoid,
      );

    case "activate":
    case "deactivate":
      // Stubs pending RFC-0006 world objects implementation.
      return Effect.fail(new CommandNotYetImplemented({ command }));

    default:
      return Effect.fail(new UnknownCalendarCommand({ command }));
  }
}
