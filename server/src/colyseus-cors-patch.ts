import type { IncomingMessage } from "node:http";
import { matchMaker } from "@colyseus/core";

/**
 * `colyseus.js` always enables `withCredentials` on matchmake HTTP calls (`lib/HTTP.js`).
 * Browsers forbid `Access-Control-Allow-Origin: *` when credentials are included; the
 * matchmaker must echo a concrete `Origin` and set `Access-Control-Allow-Credentials`.
 *
 * PoC: reflect any `Origin` header. Tighten to an allowlist before production.
 */
export function patchMatchmakeCorsForCredentials(): void {
  const controller = matchMaker.controller as {
    getCorsHeaders(req: IncomingMessage): Record<string, string>;
  };
  controller.getCorsHeaders = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      };
    }
    return { "Access-Control-Allow-Origin": "*" };
  };
}
