import { join } from "node:path";
import { gridDisk } from "h3-js";
import { ulid } from "ulid";
import { Context, Data, Effect, Layer } from "effect";
import type { PendingNotification, SayResult, ByeResult, InboxResult } from "@aie-matrix/shared-types";
import { JsonlStore } from "./store.js";
import type { ConversationStore } from "./store.js";

export class ConversationStoreUnavailable extends Data.TaggedError(
  "ConversationError.StoreUnavailable",
)<{ message: string }> {}

export type ConversationError = ConversationStoreUnavailable;

/** Minimal bridge surface needed by ConversationService — satisfied by ColyseusWorldBridge. */
export interface ConversationBridge {
  getGhostCell(ghostId: string): string | undefined;
  listOccupantsOnCell(cellId: string): string[];
  setGhostMode(ghostId: string, mode: "normal" | "conversational"): void;
  getGhostMode(ghostId: string): "normal" | "conversational";
}

export interface ConversationServiceShape {
  say(
    ghostId: string,
    content: string,
  ): Effect.Effect<SayResult, ConversationStoreUnavailable>;
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
    say(ghostId, content) {
      return Effect.gen(function* () {
        const message_id = ulid();
        const timestamp = new Date().toISOString();

        const ghostCell = bridge.getGhostCell(ghostId) ?? "";
        const clusterCells = ghostCell ? gridDisk(ghostCell, 1) : [];

        const listenerSet = new Set<string>();
        for (const cellId of clusterCells) {
          const occupants = bridge.listOccupantsOnCell(cellId);
          for (const id of occupants) {
            if (id !== ghostId) {
              listenerSet.add(id);
            }
          }
        }
        const mx_listeners = Array.from(listenerSet);

        const record = {
          thread_id: ghostId,
          message_id,
          timestamp,
          role: "user" as const,
          name: ghostId,
          content,
          mx_tile: ghostCell,
          mx_listeners,
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
