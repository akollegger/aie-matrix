import { Context, Layer } from "effect";

/**
 * Placeholder service tag for Colyseus world fanout (Effect wiring in later refactors).
 * The live process uses `startColyseusWorldBridge` from `ColyseusWorldBridge.ts` in `main.ts`.
 */
export class ColyseusWorldBridgeService extends Context.Tag("ghost-house/ColyseusWorldBridgeService")<
  ColyseusWorldBridgeService,
  { readonly noop: true }
>() {}

export const ColyseusWorldBridgeServiceLive: Layer.Layer<ColyseusWorldBridgeService> = Layer.succeed(
  ColyseusWorldBridgeService,
  { noop: true },
);
