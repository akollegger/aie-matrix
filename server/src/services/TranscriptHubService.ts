import { isEnvTruthy } from "@aie-matrix/root-env";
import { WorldBridgeService } from "@aie-matrix/server-world-api";
import { Context, Effect, Layer, PubSub, Queue } from "effect";

/** IRL transcript segment (IC-002). */
export interface TranscriptEvent {
  readonly source: string;
  readonly text: string;
  readonly timestamp: number;
}

export class TranscriptHub extends Context.Tag("aie-matrix/TranscriptHub")<
  TranscriptHub,
  PubSub.PubSub<TranscriptEvent>
>() {}

export const TranscriptHubLayer = Layer.scoped(
  TranscriptHub,
  Effect.gen(function* () {
    const hub = yield* PubSub.dropping<TranscriptEvent>(256);
    yield* Effect.addFinalizer(() => PubSub.shutdown(hub));
    return hub;
  }),
);

export const publishTranscript = (
  event: TranscriptEvent,
): Effect.Effect<boolean, never, TranscriptHub> =>
  Effect.gen(function* () {
    const hub = yield* TranscriptHub;
    return yield* PubSub.publish(hub, event);
  });

/**
 * Phase 5 stub: infrastructure wired, actual ghost delivery not yet implemented.
 * When complete, this will push the transcript event to the ghost via WorldBridgeService
 * (e.g. a Colyseus message or SSE). For now it only logs in debug mode.
 */
function notifyGhost(
  ghostId: string,
  event: TranscriptEvent,
): Effect.Effect<void, never, WorldBridgeService> {
  return Effect.gen(function* () {
    yield* WorldBridgeService;
    if (isEnvTruthy(process.env.AIE_MATRIX_DEBUG)) {
      yield* Effect.sync(() => {
        const preview = event.text.length > 80 ? `${event.text.slice(0, 80)}…` : event.text;
        console.info(
          `[aie-matrix] transcript ghost=${ghostId} source=${event.source} ts=${event.timestamp} text=${preview}`,
        );
      });
    }
  }) as Effect.Effect<void, never, WorldBridgeService>;
}

/** Scoped subscriber loop: one dequeue per adoption; ends when hub shuts down or scope closes. */
export const subscribeGhostToHub = (
  ghostId: string,
): Effect.Effect<never, never, TranscriptHub | WorldBridgeService> =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* TranscriptHub;
      const dequeue = yield* PubSub.subscribe(hub);
      return yield* Effect.forever(
        Queue.take(dequeue).pipe(Effect.flatMap((event) => notifyGhost(ghostId, event))),
      );
    }),
  );
