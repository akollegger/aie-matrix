import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";

function makeRosterApp() {
  const app = express();
  app.get("/v1/roster", (_req, res) => {
    const raw = process.env.RANDOM_AGENT_COUNT;
    const parsed = raw !== undefined && raw.trim() !== "" ? parseInt(raw, 10) : NaN;
    const count = Math.max(0, Number.isFinite(parsed) ? parsed : 10);
    const roster = Array.from({ length: count }, (_, i) => ({
      characterId: `wanderer-${i + 1}`,
      displayName: `Wanderer ${i + 1}`,
    }));
    res.json(roster);
  });
  return app;
}

describe("GET /v1/roster", () => {
  let server: Server;
  let port: number;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(
    () =>
      new Promise<void>((resolve) => {
        savedEnv.RANDOM_AGENT_COUNT = process.env.RANDOM_AGENT_COUNT;
        delete process.env.RANDOM_AGENT_COUNT;
        const app = makeRosterApp();
        server = app.listen(0, "127.0.0.1", () => {
          port = (server.address() as { port: number }).port;
          resolve();
        });
      }),
  );

  afterEach(
    () =>
      new Promise<void>((resolve) => {
        if (savedEnv.RANDOM_AGENT_COUNT === undefined) {
          delete process.env.RANDOM_AGENT_COUNT;
        } else {
          process.env.RANDOM_AGENT_COUNT = savedEnv.RANDOM_AGENT_COUNT;
        }
        server.close(() => resolve());
      }),
  );

  it("returns 10 entries by default (RANDOM_AGENT_COUNT unset)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/roster`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(10);
  });

  it("returns N entries when RANDOM_AGENT_COUNT=3", async () => {
    process.env.RANDOM_AGENT_COUNT = "3";
    const res = await fetch(`http://127.0.0.1:${port}/v1/roster`);
    const body = await res.json();
    expect(body).toHaveLength(3);
  });

  it("returns empty array when RANDOM_AGENT_COUNT=0", async () => {
    process.env.RANDOM_AGENT_COUNT = "0";
    const res = await fetch(`http://127.0.0.1:${port}/v1/roster`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it("each entry has characterId and displayName with correct format", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/roster`);
    const body = await res.json();
    for (let i = 0; i < body.length; i++) {
      expect(body[i]).toMatchObject({
        characterId: `wanderer-${i + 1}`,
        displayName: `Wanderer ${i + 1}`,
      });
    }
  });

  it("falls back to 10 when RANDOM_AGENT_COUNT is not a valid number", async () => {
    process.env.RANDOM_AGENT_COUNT = "abc";
    const res = await fetch(`http://127.0.0.1:${port}/v1/roster`);
    const body = await res.json();
    expect(body).toHaveLength(10);
  });
});
