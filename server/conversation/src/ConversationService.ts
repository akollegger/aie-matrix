import { join } from "node:path";
import { gridDisk } from "h3-js";
import { ulid } from "ulid";
import { Context, Data, Effect, Layer } from "effect";
import type { PendingNotification, SayResult, ByeResult, InboxResult } from "@aie-matrix/shared-types";
import { worldNow } from "@aie-matrix/shared-types";
import { JsonlStore } from "./store.js";
import type { ConversationStore } from "./store.js";

export class ConversationStoreUnavailable extends Data.TaggedError(
  "ConversationError.StoreUnavailable",
)<{ message: string }> {}

export class ConversationGhostNoPosition extends Data.TaggedError(
  "ConversationError.GhostNoPosition",
)<{ ghostId: string }> {}

export type ConversationError = ConversationStoreUnavailable | ConversationGhostNoPosition;

/** Minimal bridge surface needed by ConversationService — satisfied by ColyseusWorldBridge. */
export interface ConversationBridge {
  getGhostCell(ghostId: string): string | undefined;
  listOccupantsOnCell(cellId: string): string[];
  setGhostMode(ghostId: string, mode: "normal" | "conversational"): void;
  getGhostMode(ghostId: string): "normal" | "conversational";
}

export interface ConversationServiceShape {
  /**
   * Persist a "<ghost> says: <content>" message to the conversation log
   * and notify each listener's inbox.
   *
   * `displayName` overrides the stored `record.name` — pass it when the
   * speaker has a human-readable identity (e.g. "Django Decypher").
   * When omitted, `record.name` falls back to `ghostId`, which is what
   * legacy callers (the older random-agent path) sent. Carrying the
   * displayName at write-time means recipients read the persistent
   * identity directly from the message — no second lookup against the
   * registry, no leaky `ghost_<prefix>` fallback on first sighting.
   */
  say(
    ghostId: string,
    content: string,
    to?: string,
    displayName?: string,
    /** Optional non-verbal/social-register cue — e.g. "greet",
     *  "befriend". Stored on the conversation record so recipients can
     *  read the speaker's register, not just the words. Does NOT trigger
     *  world effects; state-changing acts have dedicated tools. */
    intent?: string,
    /** Caller role from JWT — "human" exempts directed (to-specified) messages from the position check. */
    callerRole?: string,
  ): Effect.Effect<SayResult, ConversationStoreUnavailable | ConversationGhostNoPosition>;
  bye(ghostId: string): Effect.Effect<ByeResult>;
  inbox(ghostId: string): Effect.Effect<InboxResult>;
}

export class ConversationService extends Context.Tag("aie-matrix/ConversationService")<
  ConversationService,
  ConversationServiceShape
>() {}

function makeConversationService(
  store: ConversationStore,
  bridge: ConversationBridge,
): ConversationServiceShape {
  const inboxQueues = new Map<string, PendingNotification[]>();

  function getQueue(ghostId: string): PendingNotification[] {
    let q = inboxQueues.get(ghostId);
    if (!q) {
      q = [];
      inboxQueues.set(ghostId, q);
    }
    return q;
  }

  return {
    say(ghostId, content, to?: string, displayName?: string, intent?: string, callerRole?: string) {
      return Effect.gen(function* () {
        const message_id = ulid();
        const timestamp = worldNow();

        const rawCell = bridge.getGhostCell(ghostId);
        // Normalize recipient once; use throughout to avoid empty-string listener keys.
        const recipient = typeof to === "string" && to.trim().length > 0 ? to.trim() : undefined;
        // Human callers with an explicit recipient are exempt from the position check —
        // they have no world position but can still address a specific ghost directly.
        const humanDirected = callerRole === "human" && recipient !== undefined;
        if (!rawCell && !humanDirected) {
          return yield* Effect.fail(new ConversationGhostNoPosition({ ghostId }));
        }
        const ghostCell = rawCell ?? "";

        let mx_listeners: string[];
        if (recipient !== undefined) {
          mx_listeners = [recipient];
        } else {
          const clusterCells = gridDisk(ghostCell, 1);
          const listenerSet = new Set<string>();
          for (const cellId of clusterCells) {
            const occupants = bridge.listOccupantsOnCell(cellId);
            for (const id of occupants) {
              if (id !== ghostId) {
                listenerSet.add(id);
              }
            }
          }
          mx_listeners = Array.from(listenerSet);
        }

        const effectiveName =
          typeof displayName === "string" && displayName.trim().length > 0
            ? displayName.trim()
            : ghostId;
        const record = {
          thread_id: ghostId,
          message_id,
          timestamp,
          role: "user" as const,
          name: effectiveName,
          content,
          mx_tile: ghostCell,
          mx_listeners,
          ...(intent !== undefined && intent.trim().length > 0
            ? { intent: intent.trim() }
            : {}),
        };

        yield* Effect.tryPromise({
          try: () => store.append(record),
          catch: (e) =>
            new ConversationStoreUnavailable({
              message: e instanceof Error ? e.message : String(e),
            }),
        });

        bridge.setGhostMode(ghostId, "conversational");

        for (const listenerId of mx_listeners) {
          getQueue(listenerId).push({ thread_id: ghostId, message_id });
        }

        return { message_id, mx_listeners };
      });
    },

    bye(ghostId) {
      return Effect.sync(() => {
        const previous_mode = bridge.getGhostMode(ghostId);
        bridge.setGhostMode(ghostId, "normal");
        return { previous_mode };
      });
    },

    inbox(ghostId) {
      return Effect.sync(() => {
        const q = inboxQueues.get(ghostId) ?? [];
        inboxQueues.set(ghostId, []);
        return { notifications: q };
      });
    },
  };
}

export const makeConversationLayer = (
  bridge: ConversationBridge,
  store?: ConversationStore,
): Layer.Layer<ConversationService> => {
  const dataDir = process.env.CONVERSATION_DATA_DIR ?? join(process.cwd(), "data/conversations");
  const resolvedStore = store ?? new JsonlStore(dataDir);
  return Layer.succeed(ConversationService, makeConversationService(resolvedStore, bridge));
};
