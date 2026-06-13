/** Typed payloads for each known world event kind. */
export interface SessionStartPayload {
  readonly sessionId: string;
}

export interface ContractSubmittedPayload {
  readonly contractId: string;
  readonly contractorId: string;
}

export interface MessageNewPayload {
  readonly from: string;
  readonly text: string;
  readonly priority: string;
}

/** Typed world event discriminated union. Unknown kinds carry `Record<string, unknown>`. */
export type WorldEvent =
  | { readonly schema: "aie-matrix.world-event.v1"; readonly kind: "world.session.start";      readonly payload: SessionStartPayload;      readonly ghostId: string; readonly eventId: string; readonly sentAt: string }
  | { readonly schema: "aie-matrix.world-event.v1"; readonly kind: "world.contract.submitted"; readonly payload: ContractSubmittedPayload; readonly ghostId: string; readonly eventId: string; readonly sentAt: string }
  | { readonly schema: "aie-matrix.world-event.v1"; readonly kind: "world.message.new";        readonly payload: MessageNewPayload;        readonly ghostId: string; readonly eventId: string; readonly sentAt: string }
  | { readonly schema: "aie-matrix.world-event.v1"; readonly kind: "world.leaderboard.updated" | (string & {}); readonly payload: Record<string, unknown>; readonly ghostId: string; readonly eventId: string; readonly sentAt: string };

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
