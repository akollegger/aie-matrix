/** Subset of IC-004 for parsing in the echo executor. */
export type WorldEvent = {
  readonly schema: "aie-matrix.world-event.v1";
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly ghostId: string;
  readonly eventId: string;
  readonly sentAt: string;
};
