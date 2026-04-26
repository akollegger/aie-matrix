import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Effect, ManagedRuntime } from "effect";
import { Gram } from "@relateby/pattern";
import { makeMapServiceLayer } from "../src/map/MapService.js";
import { parseMapsPath, tryHandleMapAssetGet } from "../src/map/MapRoutes.js";

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

function httpGetBuffer(url: string): Promise<{ status: number; headers: NodeJS.Dict<string | string[]>; body: Buffer }> {
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
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Minimal Tiled TMJ shape (Phaser / map loader expectations). */
function assertTmjJsonShape(data: unknown): void {
  assert.ok(data !== null && typeof data === "object");
  const o = data as Record<string, unknown>;
  for (const k of ["width", "height", "layers", "tilesets"] as const) {
    assert.ok(k in o, `missing TMJ field: ${k}`);
  }
  assert.ok(Array.isArray(o.layers));
  assert.ok(Array.isArray(o.tilesets));
  assert.equal(typeof o.width, "number");
  assert.equal(typeof o.height, "number");
}

test("GET /maps/freeplay → 200 text/plain; charset=utf-8", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime
        .runPromise(tryHandleMapAssetGet(req, res, url, {}))
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
    const r = await httpGet(`http://127.0.0.1:${port}/maps/freeplay`);
    server.close();
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "text/plain; charset=utf-8");
    const exit = await Effect.runPromiseExit(Gram.parse(r.body));
    assert.equal(exit._tag, "Success");
  } finally {
    await runtime.dispose();
  }
});

test("GET /maps/freeplay?format=gram → 200 same content-type", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapAssetGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/freeplay?format=gram`);
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
      void runtime.runPromise(tryHandleMapAssetGet(req, res, url, {})).catch(() => {
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

test("GET /maps/freeplay?format=unknown → 400 JSON", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapAssetGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGet(`http://127.0.0.1:${port}/maps/freeplay?format=unknown`);
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

test("US3: GET /maps/freeplay?format=tmj — 200, application/json, byte-identical TMJ", async () => {
  const layer = makeMapServiceLayer(repoRoot);
  const runtime = ManagedRuntime.make(layer);
  try {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void runtime.runPromise(tryHandleMapAssetGet(req, res, url, {})).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const r = await httpGetBuffer(`http://127.0.0.1:${port}/maps/freeplay?format=tmj`);
    server.close();
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/json");
    const onDisk = await readFile(join(repoRoot, "maps/sandbox/freeplay.tmj"));
    assert.ok(r.body.equals(onDisk), "response body must match source .tmj bytes exactly");
    assertTmjJsonShape(JSON.parse(r.body.toString("utf8")));
  } finally {
    await runtime.dispose();
  }
});
