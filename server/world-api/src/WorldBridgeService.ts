import type { ColyseusWorldBridge } from "./colyseus-bridge.js";
import { Context, Layer } from "effect";

export class WorldBridgeService extends Context.Tag("aie-matrix/WorldBridgeService")<
  WorldBridgeService,
  ColyseusWorldBridge
>() {}

export const makeWorldBridgeLayer = (bridge: ColyseusWorldBridge): Layer.Layer<WorldBridgeService> =>
  Layer.succeed(WorldBridgeService, bridge);
