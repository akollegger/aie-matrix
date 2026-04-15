import { Data } from "effect";

export class WorldBridgeNotReady extends Data.TaggedError("WorldBridgeError.NotReady")<{
  readonly message?: string;
}> {}

export class WorldBridgeNoNavigableCells extends Data.TaggedError("WorldBridgeError.NoNavigableCells")<{
  readonly message: string;
}> {}

export type WorldBridgeError = WorldBridgeNotReady | WorldBridgeNoNavigableCells;
