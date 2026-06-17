import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Effect, ManagedRuntime } from "effect";
import { Gram } from "@relateby/pattern";
import { makeMapServiceLayer } from "../src/map/MapService.js";
import { parseMapsPath, tryHandleMapGet } from "../src/map/MapRoutes.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("parseMapsPath returns undefined for malformed percent-encoding in mapId", () => {
  assert.equal(parseMapsPath("/maps/bad%"), undefined);
});

function httpGet(url: string): Promise<{ status: number; headers: NodeJS.Dict<string | string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: "GET",
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as NodeJS.Dict<string | string[]>,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}


test("GET /maps/moscone-aiewf-mini → 200 text/plain; charset=utf-8", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime
        .runPromise(tryHandleMapGet(req, res, url, {}))
        .then((handled) => {
          if (!handled && !res.headersSent) {
            res.writeHead(404).end();
          }
        })
        .catch(() => {
          if (!res.headersSent) {
            res.writeHead(500).end();
          }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/moscone-aiewf-mini`);
    server.close();
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "text/plain; charset=utf-8");
    const exit = await Effect.runPromiseExit(Gram.parse(r.body));
    assert.equal(exit._tag, "Success");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps/moscone-aiewf-mini?format=gram → 200 same content-type", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/moscone-aiewf-mini?format=gram`);
    server.close();
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "text/plain; charset=utf-8");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps/nonexistent → 404 JSON", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/nonexistent`);
    server.close();
    assert.equal(r.status, 404);
    assert.equal(r.headers["content-type"], "application/json");
    const j = JSON.parse(r.body) as { error: string; mapId: string };
    assert.equal(j.error, "MapNotFoundError");
    assert.equal(j.mapId, "nonexistent");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps/moscone-aiewf-mini?format=unknown → 400 JSON", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/moscone-aiewf-mini?format=unknown`);
    server.close();
    assert.equal(r.status, 400);
    assert.equal(r.headers["content-type"], "application/json");
    const j = JSON.parse(r.body) as { error: string; requested: string };
    assert.equal(j.error, "UnsupportedFormatError");
    assert.equal(j.requested, "unknown");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps/moscone-aiewf-mini?format=tmj → 400 (TMJ no longer supported)", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/moscone-aiewf-mini?format=tmj`);
    server.close();
    assert.equal(r.status, 400);
    assert.equal(r.headers["content-type"], "application/json");
    const j = JSON.parse(r.body) as { error: string; requested: string };
    assert.equal(j.error, "UnsupportedFormatError");
    assert.equal(j.requested, "tmj");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps → 200 application/json; lists known map ids with links", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    for (const path of ["/maps", "/maps/"] as const) {
      const r = await httpGet(`http://127.0.0.1:${port}${path}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers["content-type"], "application/json; charset=utf-8");
      const j = JSON.parse(r.body) as { maps: { id: string; links: { self: string; gram: string } }[] };
      assert.ok(Array.isArray(j.maps), "body.maps must be an array");
      assert.ok(j.maps.length > 0, "repo must index at least one map");
      const moscone-aiewf-mini = j.maps.find((m) => m.id === "moscone-aiewf-mini");
      assert.ok(moscone-aiewf-mini, "expected moscone-aiewf-mini in index");
      const base = `http://127.0.0.1:${port}`;
      assert.equal(moscone-aiewf-mini!.links.self, `${base}/maps/moscone-aiewf-mini`);
      assert.equal(moscone-aiewf-mini!.links.gram, `${base}/maps/moscone-aiewf-mini?format=gram`);
      assert.ok(!("tmj" in moscone-aiewf-mini!.links), "links must not include tmj");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.dispose();
  }
});

test("GET /maps/active → 200 with moscone-aiewf-mini content when activeGramPath set", async () => {
  const activeGramPath = join(repoRoot, "maps/moscone/moscone-aiewf-mini.map.gram");
  const layer = makeMapServiceLayer(repoRoot, activeGramPath);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/active`);
    server.close();
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "text/plain; charset=utf-8");
    assert.ok(r.body.includes("moscone-aiewf-mini"), "body should contain the moscone-aiewf-mini map");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps/active → 404 when no activeGramPath set", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/active`);
    server.close();
    assert.equal(r.status, 404);
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps → body includes active field matching configured map", async () => {
  const activeGramPath = join(repoRoot, "maps/moscone/moscone-aiewf-mini.map.gram");
  const layer = makeMapServiceLayer(repoRoot, activeGramPath);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps`);
    server.close();
    const j = JSON.parse(r.body) as { maps: unknown[]; active: string | null };
    assert.equal(j.active, "moscone-aiewf-mini");
  } finally {
    await runtime.dispose();
  }
});
