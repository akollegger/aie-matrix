import { test, expect } from "@playwright/test";

test("world-api health returns ok", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { status?: string };
  expect(body.status).toBe("ok");
});

test("spectator room endpoint returns roomId", async ({ request }) => {
  const res = await request.get("/spectator/room");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { roomId?: string };
  expect(typeof body.roomId).toBe("string");
  expect(body.roomId!.length).toBeGreaterThan(0);
});

test("maps list is non-empty", async ({ request }) => {
  const res = await request.get("/maps");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { maps?: unknown[] };
  expect(Array.isArray(body.maps)).toBe(true);
  expect(body.maps!.length).toBeGreaterThan(0);
});
