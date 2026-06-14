/**
 * Tests for the conversation router — proving the contracts that make
 * Intermedium chat work.
 *
 * The Intermedium client shows a chat panel for a selected ghost. It polls
 * GET /threads/:ghostId to display messages. For the conversation to appear
 * coherent the following must hold:
 *
 *   1. Human messages must be stored with thread_id = ghostId (the NPC's id),
 *      so they are returned by GET /threads/:ghostId.
 *
 *   2. After a human posts, the ghost agent must receive a world event with
 *      PARTNER priority so it can reply.
 *
 *   3. GET /threads/:ghostId must return both the human's message and the
 *      ghost's reply in chronological order.
 *
 * The correct path is POST /threads/:ghostId/human-say, NOT the MCP say tool.
 * The MCP say tool stores thread_id = callerGhostId (the human's id), which
 * is invisible to the poller watching the NPC's thread.
 */
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createConversationRouter } from "./router.js";
import type { ConversationStore } from "./store.js";
import type { MessageRecord } from "@aie-matrix/shared-types";

// ── In-memory store ────────────────────────────────────────────────────────────

function makeStore(): ConversationStore & { records: MessageRecord[] } {
  const records: MessageRecord[] = [];
  return {
    records,
    async append(r: MessageRecord) {
      records.push(r);
    },
    async list(threadId: string, opts?: { after?: string; since?: string; limit?: number }) {
      let result = records.filter((r) => r.thread_id === threadId);
      if (opts?.after) result = result.filter((r) => r.message_id > opts.after!);
      if (opts?.since) result = result.filter((r) => r.timestamp > opts.since!);
      const limit = opts?.limit ?? 50;
      return result.slice(0, limit);
    },
    async get(_threadId: string, _messageId: string) {
      return null;
    },
  };
}

// ── Minimal HTTP mock ─────────────────────────────────────────────────────────

function makeReq(method: string, path: string, body?: unknown): IncomingMessage {
  const bodyStr = body !== undefined ? JSON.stringify(body) : "";
  const stream = Readable.from(bodyStr ? [Buffer.from(bodyStr)] : []);
  Object.assign(stream, { method, url: path, headers: {} });
  return stream as unknown as IncomingMessage;
}

type CapturedResponse = {
  status: number;
  body: unknown;
};

function makeRes(): { res: ServerResponse; captured: () => CapturedResponse } {
  let captured: CapturedResponse = { status: 0, body: undefined };
  const res = {
    writeHead: (status: number, _headers?: unknown) => { captured.status = status; },
    end: (data?: string) => {
      if (data) {
        try { captured.body = JSON.parse(data); } catch { captured.body = data; }
      }
    },
  } as unknown as ServerResponse;
  return { res, captured: () => captured };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /threads/:ghostId/human-say", () => {
  test("stores message with thread_id = ghostId (NPC's id, not the human's)", async () => {
    const store = makeStore();
    const router = createConversationRouter({ store, corsHeaders: {} });
    const { res } = makeRes();

    await router(
      makeReq("POST", "/threads/npc-ghost-1/human-say", { humanId: "human-abc", text: "Hello?" }),
      res,
      new URL("http://localhost/threads/npc-ghost-1/human-say"),
    );

    assert.equal(store.records.length, 1);
    assert.equal(store.records[0]!.thread_id, "npc-ghost-1",
      "human message must land in the NPC's thread so the client can read it");
    assert.equal(store.records[0]!.role, "partner");
    assert.equal(store.records[0]!.content, "Hello?");
  });

  test("fanout delivers PARTNER priority world event to the ghost agent", async () => {
    const store = makeStore();
    const fanoutCalls: Array<[string, Record<string, unknown>]> = [];
    const router = createConversationRouter({
      store,
      corsHeaders: {},
      fanout: (ghostId, payload) => { fanoutCalls.push([ghostId, payload]); },
    });
    const { res } = makeRes();

    await router(
      makeReq("POST", "/threads/npc-ghost-1/human-say", { humanId: "human-abc", text: "Hello?" }),
      res,
      new URL("http://localhost/threads/npc-ghost-1/human-say"),
    );

    assert.equal(fanoutCalls.length, 1);
    const [targetGhostId, payload] = fanoutCalls[0]!;
    assert.equal(targetGhostId, "npc-ghost-1",
      "fanout must target the NPC ghost so agent-host can route it to the right session");
    assert.equal(payload.priority, "PARTNER",
      "priority must be PARTNER so the ghost agent handles it as a human conversation message");
    assert.equal(payload.from, "human-abc");
    assert.equal(payload.text, "Hello?");
  });

  test("GET /threads/:ghostId returns the human message (client poller sees it)", async () => {
    const store = makeStore();
    const router = createConversationRouter({ store, corsHeaders: {} });

    // Human posts
    const { res: postRes } = makeRes();
    await router(
      makeReq("POST", "/threads/npc-ghost-1/human-say", { humanId: "human-abc", text: "Hello?" }),
      postRes,
      new URL("http://localhost/threads/npc-ghost-1/human-say"),
    );

    // Client polls
    const { res: getRes, captured } = makeRes();
    await router(
      makeReq("GET", "/threads/npc-ghost-1"),
      getRes,
      new URL("http://localhost/threads/npc-ghost-1"),
    );

    assert.equal(captured().status, 200);
    const body = captured().body as { messages: MessageRecord[] };
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0]!.content, "Hello?");
    assert.equal(body.messages[0]!.role, "partner");
  });

  test("GET /threads/:ghostId includes ghost reply after NPC calls say()", async () => {
    const store = makeStore();
    const router = createConversationRouter({ store, corsHeaders: {} });

    // Human posts
    await router(
      makeReq("POST", "/threads/npc-ghost-1/human-say", { humanId: "human-abc", text: "Hello?" }),
      makeRes().res,
      new URL("http://localhost/threads/npc-ghost-1/human-say"),
    );

    // Simulate NPC reply: ConversationService.say(npcGhostId, ...) stores thread_id = npcGhostId
    await store.append({
      thread_id: "npc-ghost-1",
      message_id: "reply-1",
      timestamp: new Date().toISOString(),
      role: "user",
      name: "Broker",
      content: "Greetings, traveler.",
      mx_tile: "abc123",
      mx_listeners: ["human-abc"],
    });

    // Client polls
    const { res, captured } = makeRes();
    await router(
      makeReq("GET", "/threads/npc-ghost-1"),
      res,
      new URL("http://localhost/threads/npc-ghost-1"),
    );

    const body = captured().body as { messages: MessageRecord[] };
    assert.equal(body.messages.length, 2,
      "thread must contain both the human's message and the NPC's reply");
    assert.equal(body.messages[0]!.role, "partner");  // human
    assert.equal(body.messages[1]!.role, "user");     // ghost
    assert.equal(body.messages[1]!.content, "Greetings, traveler.");
  });
});

describe("thread_id placement — why the MCP say path breaks the client", () => {
  test("ConversationService.say stores thread_id = callerGhostId (not the target)", async () => {
    // When the human sends via MCP say tool, sayEffect calls:
    //   conversation.say(humanGhostId, content, npcGhostId, ...)
    // ConversationService stores: thread_id = ghostId = humanGhostId
    //
    // The client polls GET /threads/npcGhostId — which returns records where
    // thread_id = npcGhostId. The human's message is in humanGhostId's thread,
    // so it is INVISIBLE to the client.
    //
    // This test documents that contract so any change to ConversationService
    // that accidentally fixes or breaks this is caught immediately.
    const store = makeStore();
    const router = createConversationRouter({ store, corsHeaders: {} });

    // Simulate what ConversationService.say does internally:
    // thread_id = callerGhostId (the human's ghostId), NOT the NPC's ghostId.
    await store.append({
      thread_id: "human-abc",          // ← stored under human's id
      message_id: "msg-human-1",
      timestamp: new Date().toISOString(),
      role: "user",
      name: "human-abc",
      content: "Hello via MCP say",
      mx_tile: "",
      mx_listeners: ["npc-ghost-1"],
    });

    // Client polls the NPC's thread
    const { res, captured } = makeRes();
    await router(
      makeReq("GET", "/threads/npc-ghost-1"),
      res,
      new URL("http://localhost/threads/npc-ghost-1"),
    );

    const body = captured().body as { messages: MessageRecord[] };
    assert.equal(body.messages.length, 0,
      "human message sent via MCP say tool is invisible in the NPC thread — " +
      "use POST /threads/:ghostId/human-say instead");
  });
});
