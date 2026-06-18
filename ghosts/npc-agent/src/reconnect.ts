import { Data, Duration, Schedule } from "effect";

/** Number of consecutive tick failures before a ghost's loop exits and reconnects. */
export const CONSECUTIVE_FAILURE_THRESHOLD = 5;

/** Tagged error emitted when consecutive tick failures exceed the threshold. */
export class McpConnectionBroken extends Data.TaggedError("McpConnectionBroken")<{
  readonly ghostId: string;
  readonly reason: string;
}> {}

/**
 * Exponential backoff schedule for MCP reconnect attempts.
 * Starts at 2 seconds, doubles each attempt, caps at 60 seconds per attempt.
 * There is no hard retry limit — the loop continues until the ghost
 * fiber is interrupted by a new spawn or pod shutdown.
 *
 * Schedule.union takes the minimum delay at each step, so once the exponential
 * grows beyond 60 s the spaced schedule wins and holds it at 60 s.
 */
export function makeReconnectSchedule(): Schedule.Schedule<unknown, McpConnectionBroken, never> {
  return Schedule.union(
    Schedule.exponential("2 seconds", 2),
    Schedule.spaced(Duration.seconds(60)),
  ) as unknown as Schedule.Schedule<unknown, McpConnectionBroken, never>;
}

/**
 * Emit a structured `npc-agent.mcp.degraded` event (one per state transition).
 * The caller is responsible for calling this exactly once when the ghost
 * enters degraded state (after threshold is reached).
 */
export function logDegraded(ghostId: string): void {
  console.log(
    JSON.stringify({
      event: "npc-agent.mcp.degraded",
      ghostId,
      ts: new Date().toISOString(),
    }),
  );
}

/**
 * Emit a structured `npc-agent.mcp.recovered` event (one per state transition).
 * The caller is responsible for calling this exactly once when the ghost
 * successfully reconnects and completes its first tick.
 */
export function logRecovered(ghostId: string): void {
  console.log(
    JSON.stringify({
      event: "npc-agent.mcp.recovered",
      ghostId,
      ts: new Date().toISOString(),
    }),
  );
}
