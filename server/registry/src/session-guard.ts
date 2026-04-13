import type { RegistryStore } from "./store.js";
import type { RegistryErrorCode } from "@aie-matrix/shared-types";

export class RegistryConflictError extends Error {
  readonly code: RegistryErrorCode;
  readonly httpStatus: number;

  constructor(code: RegistryErrorCode, message: string, httpStatus = 409) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * IC-002 exclusivity: one active ghost per caretaker; adoption only when house exists.
 */
export function assertAdoptionAllowed(
  store: RegistryStore,
  caretakerId: string,
  ghostHouseId: string,
): void {
  if (!store.caretakers.has(caretakerId)) {
    throw new RegistryConflictError("UNKNOWN_CARETAKER", "Unknown caretaker", 404);
  }
  if (!store.houses.has(ghostHouseId)) {
    throw new RegistryConflictError("UNKNOWN_GHOST_HOUSE", "Unknown ghost house", 404);
  }
  if (store.activeByCaretaker.has(caretakerId)) {
    throw new RegistryConflictError(
      "CARETAKER_ALREADY_HAS_GHOST",
      "Caretaker already has an active adoption",
    );
  }
}
