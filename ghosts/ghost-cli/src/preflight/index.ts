import { Effect } from "effect";

import type { GhostIdentity } from "./handshake.js";
import { runHandshake } from "./handshake.js";
import { runEnvScan } from "./env-scan.js";
import { runReachability } from "./reachability.js";
import type { PreFlightError } from "./errors.js";

export type { GhostIdentity } from "./handshake.js";
export * from "./errors.js";

/** Runs pre-flight phases 1–3 in order; stops at the first failure. */
export const runPreflight = (input: {
  readonly token: string;
  readonly url: string;
}): Effect.Effect<GhostIdentity, PreFlightError> =>
  Effect.gen(function* () {
    yield* runEnvScan(input);
    yield* runReachability(input.url.trim());
    return yield* runHandshake(input);
  });
