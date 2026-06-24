/**
 * Tests for POST /admin/reset HTTP route.
 *
 * Uses LocalLiveSessionService (no Neo4j or Redis required).
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";

import { tryHandleAdmin } from "../src/live/LiveSessionRoutes.js";
import { makeLocalLiveSessionLayer } from "../src/live/LocalLiveSessionService.js";
import { LiveSessionService } from "../src/live/LiveSessionService.js";
import { makeLocalMapManagementLayer } from "../src/map/LocalMapManagementService.js";
import { makeMapServiceLayer } from "../src/map/MapService.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const ADMIN_TOKEN = "test-admin-token";

process.env["ADMIN_TOKEN"] = ADMIN_TOKEN;

function makeTestLayer() {
  const mapSvc = makeMapServiceLayer(REPO_ROOT);
  const mapMgmt = makeLocalMapManagementLayer(REPO_ROOT).pipe(Layer.provide(mapSvc));
  const liveSvc = makeLocalLiveSessionLayer().pipe(Layer.provide(Layer.mergeAll(mapSvc, mapMgmt)));
  return Layer.mergeAll(mapSvc, mapMgmt, liveSvc);
}

type TestRuntime = ManagedRuntime.ManagedRuntime<
  import("../src/map/MapService.js").MapService |
  import("../src/map/MapManagementService.js").MapManagementService |
  import("../src/live/LiveSessionService.js").LiveSessionService,
  never
>;

function makeServer(runtime: TestRuntime): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime
        .runPromise(
          tryHandleAdmin(req, res, url, {}).pipe(
            Effect.catchAll(() =>
              Effect.sync(() => {
                if (!res.headersSent) res.writeHead(500).end();
                return true as const;
              }),
            ),
          ),
        )
        .then((handled) => {
          if (!handled && !res.headersSent) res.writeHead(404).end();
        });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
    server.on("error", reject);
  });
}

function httpPost(url: string, token?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Length": 0,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch { parsed = text; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test("POST /admin/reset returns 401 without token", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const { server, url } = await makeServer(runtime as TestRuntime);
  try {
    const res = await httpPost(`${url}/admin/reset`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
    await runtime.dispose();
  }
});

test("POST /admin/reset returns 401 with wrong token", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const { server, url } = await makeServer(runtime as TestRuntime);
  try {
    const res = await httpPost(`${url}/admin/reset`, "wrong-token");
    assert.equal(res.status, 401);
  } finally {
    server.close();
    await runtime.dispose();
  }
});

test("POST /admin/reset returns 200 with counts when no sessions exist", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const { server, url } = await makeServer(runtime as TestRuntime);
  try {
    const res = await httpPost(`${url}/admin/reset`, ADMIN_TOKEN);
    assert.equal(res.status, 200);
    const body = res.body as { sessionsEnded: number; ledgerEntriesCleared: number; groupsCleared: number };
    assert.equal(body.sessionsEnded, 0);
    assert.equal(typeof body.ledgerEntriesCleared, "number");
    assert.equal(typeof body.groupsCleared, "number");
  } finally {
    server.close();
    await runtime.dispose();
  }
});

test("POST /admin/reset ends active sessions and returns sessionsEnded:1", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const { server, url } = await makeServer(runtime as TestRuntime);
  try {
    // Create a session first
    await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("test-reset", [])),
    );

    const res = await httpPost(`${url}/admin/reset`, ADMIN_TOKEN);
    assert.equal(res.status, 200);
    const body = res.body as { sessionsEnded: number };
    assert.equal(body.sessionsEnded, 1);

    // Confirm no active sessions remain
    const active = await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.list("active")),
    );
    assert.equal(active.length, 0);
  } finally {
    server.close();
    await runtime.dispose();
  }
});

test("POST /admin/reset is idempotent — second call returns sessionsEnded:0", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const { server, url } = await makeServer(runtime as TestRuntime);
  try {
    await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("test-reset", [])),
    );
    await httpPost(`${url}/admin/reset`, ADMIN_TOKEN);
    const second = await httpPost(`${url}/admin/reset`, ADMIN_TOKEN);
    assert.equal(second.status, 200);
    const body = second.body as { sessionsEnded: number };
    assert.equal(body.sessionsEnded, 0);
  } finally {
    server.close();
    await runtime.dispose();
  }
});
