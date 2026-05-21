import type { RegistryStore } from "./store.js";
import { Effect } from "effect";
import {
  registryCaretakerAlreadyHasGhost,
  registryUnknownCaretaker,
  registryUnknownAgentHost,
  type RegistryHttpError,
} from "./registry-errors.js";

/**
 * IC-002 exclusivity: one active ghost per caretaker; adoption only when house exists.
 */
export function assertAdoptionAllowed(
  store: RegistryStore,
  caretakerId: string,
  agentHostId: string,
): Effect.Effect<void, RegistryHttpError> {
  if (!store.caretakers.has(caretakerId)) {
    return Effect.fail(registryUnknownCaretaker("Unknown caretaker"));
  }
  if (!store.houses.has(agentHostId)) {
    return Effect.fail(registryUnknownAgentHost("Unknown ghost house"));
  }
  if (store.activeByCaretaker.has(caretakerId)) {
    return Effect.fail(
      registryCaretakerAlreadyHasGhost("Caretaker already has an active adoption"),
    );
  }
  return Effect.void;
}
