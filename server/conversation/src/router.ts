import type { IncomingMessage, ServerResponse } from "node:http";
import { ulid } from "ulid";
import type { MessageRecord } from "@aie-matrix/shared-types";
import type { ConversationStore } from "./store.js";

export interface ConversationRouterDeps {
  readonly store: ConversationStore;
  /** CORS headers applied to every response. */
  readonly corsHeaders: Record<string, string>;
  /**
   * Broadcasts a world-v1 Colyseus event so ghost agents receive the message
   * via A2A push. Called after persisting human-say messages.
   */
  readonly fanout?: (ghostId: string, payload: Record<string, unknown>) => void;
  /**
   * @deprecated Registry and spectatorToken are no longer used; GET is public.
   * Retained for call-site compatibility during migration.
   */
  readonly registry?: unknown;
  readonly spectatorToken?: string;
}

function json(res: ServerResponse, status: number, cors: Record<string, string>, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(200, Math.floor(n));
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createConversationRouter(
  deps: ConversationRouterDeps,
): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const { store, corsHeaders, fanout } = deps;

  return async (req, res, url) => {
    if (!url.pathname.startsWith("/threads")) return false;

    const segments = url.pathname.split("/").filter((s) => s.length > 0);
    if (segments[0] !== "threads") return false;

    if (segments.length < 2) {
      json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Thread path required" });
      return true;
    }

    const ghostId = segments[1]!;

    // POST /threads/:ghostId/human-say
    if (req.method === "POST" && segments[2] === "human-say") {
      let body: { humanId?: string; text?: string };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        json(res, 400, corsHeaders, { error: "BAD_JSON", message: "Body must be JSON" });
        return true;
      }
      if (typeof body.humanId !== "string" || body.humanId.trim().length === 0) {
        json(res, 400, corsHeaders, { error: "VALIDATION_FAILED", message: "humanId is required" });
        return true;
      }
      if (typeof body.text !== "string" || body.text.trim().length === 0) {
        json(res, 400, corsHeaders, { error: "VALIDATION_FAILED", message: "text is required" });
        return true;
      }
      const humanId = body.humanId.trim();
      const text = body.text.trim();
      const record: MessageRecord = {
        thread_id: ghostId,
        message_id: ulid(),
        timestamp: new Date().toISOString(),
        role: "partner",
        name: humanId,
        content: text,
        mx_tile: "",
        mx_listeners: [ghostId],
      };
      await store.append(record);
      fanout?.(ghostId, { from: humanId, role: "partner", priority: "PARTNER", text });
      json(res, 201, corsHeaders, { messageId: record.message_id, ghostId });
      return true;
    }

    // GET /threads/:ghostId  or  GET /threads/:ghostId/:messageId
    if (req.method !== "GET") {
      json(res, 405, corsHeaders, { error: "METHOD_NOT_ALLOWED" });
      return true;
    }

    if (segments.length > 3) {
      json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Unknown thread path" });
      return true;
    }

    const messageId = segments[2];
    if (messageId !== undefined && messageId !== "human-say") {
      const record = await store.get(ghostId, messageId);
      if (record === null) {
        json(res, 404, corsHeaders, { error: "NOT_FOUND", message: "Ghost or message not found" });
        return true;
      }
      json(res, 200, corsHeaders, record);
      return true;
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    const after = url.searchParams.get("after") ?? undefined;
    const since = url.searchParams.get("since") ?? undefined;
    const batch = await store.list(ghostId, { after, since, limit: limit + 1 });
    const hasMore = batch.length > limit;
    const messages: MessageRecord[] = batch.slice(0, limit);
    const last = messages[messages.length - 1];
    const responseBody: { thread_id: string; messages: MessageRecord[]; next_cursor?: string } = {
      thread_id: ghostId,
      messages,
    };
    if (hasMore && last !== undefined) {
      responseBody.next_cursor = last.message_id;
    }
    json(res, 200, corsHeaders, responseBody);
    return true;
  };
}
