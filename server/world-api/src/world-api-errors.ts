import { Data } from "effect";

export class WorldApiNoPosition extends Data.TaggedError("WorldApiError.NoPosition")<{
  readonly ghostId: string;
}> {}

export class WorldApiUnknownCell extends Data.TaggedError("WorldApiError.UnknownCell")<{
  readonly cellId: string;
}> {}

export class WorldApiMapIntegrity extends Data.TaggedError("WorldApiError.MapIntegrity")<{
  readonly message: string;
}> {}

export class WorldApiMovementBlocked extends Data.TaggedError("WorldApiError.MovementBlocked")<{
  readonly message: string;
  /** Machine-stable code when the failure originated from movement evaluation (e.g. `RULESET_DENY`). */
  readonly code?: string;
}> {}

export type WorldApiError =
  | WorldApiNoPosition
  | WorldApiUnknownCell
  | WorldApiMapIntegrity
  | WorldApiMovementBlocked;
