import { Data } from "effect";

/** Invalid JSON body on registry routes (not part of IC-001 HTTP mapping). */
export class RegistryBadJson extends Data.TaggedError("RegistryBadJson")<{
  readonly message: string;
}> {}

export class RegistryUnknownCaretaker extends Data.TaggedError("RegistryError.UNKNOWN_CARETAKER")<{
  readonly code: "UNKNOWN_CARETAKER";
  readonly httpStatus: 404;
  readonly message: string;
}> {}

export class RegistryUnknownGhostHouse extends Data.TaggedError("RegistryError.UNKNOWN_GHOST_HOUSE")<{
  readonly code: "UNKNOWN_GHOST_HOUSE";
  readonly httpStatus: 404;
  readonly message: string;
}> {}

export class RegistryCaretakerAlreadyHasGhost extends Data.TaggedError(
  "RegistryError.CARETAKER_ALREADY_HAS_GHOST",
)<{
  readonly code: "CARETAKER_ALREADY_HAS_GHOST";
  readonly httpStatus: 409;
  readonly message: string;
}> {}

export type RegistryHttpError =
  | RegistryUnknownCaretaker
  | RegistryUnknownGhostHouse
  | RegistryCaretakerAlreadyHasGhost;

export function registryUnknownCaretaker(message: string): RegistryUnknownCaretaker {
  return new RegistryUnknownCaretaker({
    code: "UNKNOWN_CARETAKER",
    httpStatus: 404,
    message,
  });
}

export function registryUnknownGhostHouse(message: string): RegistryUnknownGhostHouse {
  return new RegistryUnknownGhostHouse({
    code: "UNKNOWN_GHOST_HOUSE",
    httpStatus: 404,
    message,
  });
}

export function registryCaretakerAlreadyHasGhost(message: string): RegistryCaretakerAlreadyHasGhost {
  return new RegistryCaretakerAlreadyHasGhost({
    code: "CARETAKER_ALREADY_HAS_GHOST",
    httpStatus: 409,
    message,
  });
}

export function registryErrorToHttp(error: RegistryHttpError): { status: number; body: string } {
  return {
    status: error.httpStatus,
    body: JSON.stringify({ error: error.code, message: error.message }),
  };
}
