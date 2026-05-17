import { Data } from "effect";

export class MapNotFoundError extends Data.TaggedError("MapError.NotFound")<{
  readonly mapId: string;
}> {}

export class UnsupportedFormatError extends Data.TaggedError("MapError.UnsupportedFormat")<{
  readonly format: string;
}> {}

export class GramParseError extends Data.TaggedError("MapError.GramParse")<{
  readonly path: string;
  readonly cause: string;
}> {}

export class MapNameMismatchError extends Data.TaggedError("MapError.NameMismatch")<{
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
}> {}

export class MapIdCollisionError extends Data.TaggedError("MapError.IdCollision")<{
  readonly mapId: string;
  readonly paths: readonly string[];
}> {}

export class MapFileReadError extends Data.TaggedError("MapError.FileRead")<{
  readonly path: string;
  readonly cause: string;
}> {}

export class MapPublishError extends Data.TaggedError("MapPublishError")<{
  readonly mapId: string;
  readonly cause: string;
}> {}

export class MapAlreadyActiveError extends Data.TaggedError("MapAlreadyActiveError")<{
  readonly mapId: string;
}> {}

export class MultipartParseError extends Data.TaggedError("MultipartParseError")<{
  readonly cause: string;
}> {}
