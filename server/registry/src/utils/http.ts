import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect } from "effect";
import { RegistryBadJson } from "../registry-errors.js";

export function readJsonBody(req: IncomingMessage): Effect.Effect<unknown, RegistryBadJson, never> {
  return Effect.tryPromise({
    try: () =>
      new Promise<unknown>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(Buffer.from(c)));
        req.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            reject(new RegistryBadJson({ message: "Invalid JSON body" }));
          }
        });
        req.on("error", reject);
      }),
    catch: (e) =>
      e instanceof RegistryBadJson
        ? e
        : new RegistryBadJson({ message: e instanceof Error ? e.message : String(e) }),
  });
}

export function sendJson(
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  status: number,
  body: unknown,
): Effect.Effect<void, never, never> {
  return Effect.sync(() => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(JSON.stringify(body));
  });
}

export function sendRawJsonBody(
  res: ServerResponse,
  corsHeaders: Record<string, string>,
  status: number,
  body: string,
): Effect.Effect<void, never, never> {
  return Effect.sync(() => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...corsHeaders,
    });
    res.end(body);
  });
}
