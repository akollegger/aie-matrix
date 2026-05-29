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

export class WorldApiItemNotHere extends Data.TaggedError("WorldApiError.ItemNotHere")<{
  readonly itemRef: string;
}> {}

export class WorldApiItemNotFound extends Data.TaggedError("WorldApiError.ItemNotFound")<{
  readonly itemRef: string;
}> {}

export class WorldApiItemNotCarriable extends Data.TaggedError("WorldApiError.ItemNotCarriable")<{
  readonly itemRef: string;
}> {}

export class WorldApiItemNotCarrying extends Data.TaggedError("WorldApiError.ItemNotCarrying")<{
  readonly itemRef: string;
}> {}

export class WorldApiTileFull extends Data.TaggedError("WorldApiError.TileFull")<{
  readonly h3Index: string;
}> {}

/** Item exists but is not consumable (no `tokens` field on its definition). */
export class WorldApiItemNotConsumable extends Data.TaggedError("WorldApiError.ItemNotConsumable")<{
  readonly itemRef: string;
}> {}

/** `consume` called with a non-positive amount. */
export class WorldApiInvalidConsumeAmount extends Data.TaggedError("WorldApiError.InvalidConsumeAmount")<{
  readonly itemRef: string;
  readonly requested: number;
}> {}

export class GhostInLimboError extends Data.TaggedError("GhostInLimboError")<{
  readonly ghostId: string;
}> {}

export type WorldApiError =
  | WorldApiNoPosition
  | WorldApiUnknownCell
  | WorldApiMapIntegrity
  | WorldApiMovementBlocked
  | WorldApiItemNotHere
  | WorldApiItemNotFound
  | WorldApiItemNotCarriable
  | WorldApiItemNotCarrying
  | WorldApiTileFull
  | WorldApiItemNotConsumable
  | WorldApiInvalidConsumeAmount
  | GhostInLimboError;
