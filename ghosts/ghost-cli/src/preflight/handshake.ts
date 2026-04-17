import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { Effect } from "effect";

import { GhostNotFound, TokenRejected, UnknownNetworkError, type PreFlightError } from "./errors.js";

export interface GhostIdentity {
  readonly ghostId: string;
  readonly displayName?: string;
}

const classifyHandshakeError =
  (mcpUrl: string) =>
  (e: unknown): PreFlightError => {
    const text = String(e instanceof Error ? e.message : e);
    const lower = text.toLowerCase();
    if (lower.includes("401") || lower.includes("unauthorized")) {
      return new TokenRejected();
    }
    if (lower.includes("404")) {
      return new GhostNotFound();
    }
    if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")) {
      return new UnknownNetworkError({ url: mcpUrl, detail: text });
    }
    return new TokenRejected();
  };

/** Phase 3 — MCP session + whoami (validates token and ghost placement). */
export const runHandshake = (input: {
  readonly token: string;
  readonly url: string;
}): Effect.Effect<GhostIdentity, PreFlightError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = new GhostMcpClient({
        worldApiBaseUrl: input.url,
        token: input.token,
      });
      const onErr = classifyHandshakeError(input.url);

      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => client.connect(),
          catch: onErr,
        }),
        () => Effect.promise(() => client.disconnect()),
      );

      const raw = yield* Effect.tryPromise({
        try: () => client.callTool("whoami", {}),
        catch: onErr,
      });

      const obj = raw as { ghostId?: unknown; displayName?: unknown };
      const ghostId = typeof obj.ghostId === "string" ? obj.ghostId : undefined;
      if (!ghostId) {
        return yield* Effect.fail(new GhostNotFound());
      }
      const displayName = typeof obj.displayName === "string" ? obj.displayName : undefined;

      return { ghostId, displayName };
    }),
  );
