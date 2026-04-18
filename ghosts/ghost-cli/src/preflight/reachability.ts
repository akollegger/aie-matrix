import { Effect } from "effect";

import {
  HostNotFound,
  McpEndpointNotFound,
  ServerUnreachable,
  UnknownNetworkError,
  type PreFlightError,
} from "./errors.js";

function errnoFromUnknown(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return "UNKNOWN";
}

function hostPortFromUrl(url: string): { readonly host: string; readonly port: number } {
  const u = new URL(url);
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  return { host: u.hostname, port };
}

/** Phase 2 — HTTP reachability (server listening + MCP route exists). */
export const runReachability = (mcpUrl: string): Effect.Effect<void, PreFlightError> =>
  Effect.tryPromise({
    try: async () => {
      const { host, port } = hostPortFromUrl(mcpUrl);
      const origin = new URL(mcpUrl).origin;

      let originStatus: number | undefined;

      try {
        const healthRes = await fetch(origin + "/", { method: "GET", signal: AbortSignal.timeout(3_000) });
        originStatus = healthRes.status;
      } catch (e) {
        const code = errnoFromUnknown(e);
        if (code === "ENOTFOUND") {
          throw new HostNotFound({ host });
        }
        if (code === "ECONNREFUSED" || code === "EAI_AGAIN" || code === "ECONNRESET") {
          throw new ServerUnreachable({ host, port, errno: code });
        }
        throw new UnknownNetworkError({ url: mcpUrl, detail: String(e) });
      }

      try {
        const mcpRes = await fetch(mcpUrl, { method: "GET", signal: AbortSignal.timeout(3_000) });
        if (mcpRes.status === 404) {
          throw new McpEndpointNotFound({ url: mcpUrl, originStatus });
        }
      } catch (e) {
        if (e instanceof McpEndpointNotFound) {
          throw e;
        }
        const code = errnoFromUnknown(e);
        if (code === "ENOTFOUND") {
          throw new HostNotFound({ host });
        }
        if (code === "ECONNREFUSED" || code === "EAI_AGAIN" || code === "ECONNRESET") {
          throw new ServerUnreachable({ host, port, errno: code });
        }
        throw new UnknownNetworkError({ url: mcpUrl, detail: String(e) });
      }
    },
    catch: (e) => {
      if (
        e instanceof HostNotFound ||
        e instanceof McpEndpointNotFound ||
        e instanceof ServerUnreachable ||
        e instanceof UnknownNetworkError
      ) {
        return e;
      }
      return new UnknownNetworkError({ url: mcpUrl, detail: String(e) });
    },
  });
