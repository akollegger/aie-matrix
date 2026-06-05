/** Subset of IC-004 for parsing world events in the executor. */
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
  readonly kind: WorldEventKind;
  readonly payload: Record<string, unknown>;
  readonly ghostId: string;
  readonly eventId: string;
  readonly sentAt: string;
};
