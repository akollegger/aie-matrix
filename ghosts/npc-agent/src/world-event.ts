/** Subset of IC-004 / IC-007 for parsing world events in the executor. */
export type WorldEvent = {
  readonly schema: "aie-matrix.world-event.v1";
  readonly kind: WorldEventKind;
  readonly payload: Record<string, unknown>;
  readonly ghostId: string;
  readonly eventId: string;
  readonly sentAt: string;
};

export type WorldEventKind =
  | "world.session.start"
  | "world.message.new"
  | "world.contract.submitted"
  | "world.leaderboard.updated"
  | (string & {});

export function asWorldEvent(msg: { parts?: unknown[] } | undefined): WorldEvent | null {
  for (const p of msg?.parts ?? []) {
    if (
      typeof p === "object" &&
      p !== null &&
      "kind" in p &&
      (p as Record<string, unknown>).kind === "data" &&
      "data" in p
    ) {
      const d = (p as Record<string, unknown>).data as Record<string, unknown>;
      if (d.schema === "aie-matrix.world-event.v1") {
        return d as unknown as WorldEvent;
      }
    }
  }
  return null;
}
