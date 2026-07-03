/**
 * Tests for LocalLiveSessionService.ensure() and LocalLiveSessionService.reset().
 *
 * Uses LocalLiveSessionService (no Neo4j required) so these are fast unit tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer, ManagedRuntime } from "effect";

import { makeLocalLiveSessionLayer } from "../src/live/LocalLiveSessionService.js";
import { LiveSessionService } from "../src/live/LiveSessionService.js";
import { makeLocalMapManagementLayer } from "../src/map/LocalMapManagementService.js";
import { makeMapServiceLayer } from "../src/map/MapService.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

function makeTestLayer() {
  const mapSvc = makeMapServiceLayer(REPO_ROOT);
  const mapMgmt = makeLocalMapManagementLayer(REPO_ROOT).pipe(Layer.provide(mapSvc));
  const liveSvc = makeLocalLiveSessionLayer().pipe(Layer.provide(Layer.mergeAll(mapSvc, mapMgmt)));
  return Layer.mergeAll(mapSvc, mapMgmt, liveSvc);
}

// ── ensure() ─────────────────────────────────────────────────────────────────

test("ensure() creates a session when none exists", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    const result = await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("test-session", [])),
    );
    assert.equal(result.created, true);
    assert.equal(result.session.status, "active");
    assert.equal(result.session.name, "test-session");
    assert.equal(result.warning, undefined);
  } finally {
    await runtime.dispose();
  }
});

test("ensure() returns existing session without creating a new one", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    const first = await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("session-a", [])),
    );
    assert.equal(first.created, true);

    const second = await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("session-b", [])),
    );
    assert.equal(second.created, false);
    assert.equal(second.session.id, first.session.id, "same session returned");
    assert.equal(second.session.name, "session-a", "original name preserved");
  } finally {
    await runtime.dispose();
  }
});

test("ensure() returns created:false after ensure() already ran", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    // Three calls — only first creates
    await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.ensure("s", [])));
    const r2 = await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.ensure("s", [])));
    const r3 = await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.ensure("s", [])));
    assert.equal(r2.created, false);
    assert.equal(r3.created, false);
    assert.equal(r2.session.id, r3.session.id);
  } finally {
    await runtime.dispose();
  }
});

test("ensure() creates a new session after reset()", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    const before = await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("before", [])),
    );
    assert.equal(before.created, true);

    await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.reset()));

    const after = await runtime.runPromise(
      Effect.flatMap(LiveSessionService, (svc) => svc.ensure("after", [])),
    );
    assert.equal(after.created, true);
    assert.notEqual(after.session.id, before.session.id, "new session created after reset");
    assert.equal(after.session.name, "after");
  } finally {
    await runtime.dispose();
  }
});

// ── reset() ──────────────────────────────────────────────────────────────────

test("reset() returns sessionsEnded:1 when one active session exists", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.ensure("s", [])));
    const result = await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.reset()));
    assert.equal(result.sessionsEnded, 1);
  } finally {
    await runtime.dispose();
  }
});

test("reset() returns sessionsEnded:0 when no active session exists", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    const result = await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.reset()));
    assert.equal(result.sessionsEnded, 0);
  } finally {
    await runtime.dispose();
  }
});

test("reset() marks session as ended so list() returns empty", async () => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  try {
    await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.ensure("s", [])));
    await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.reset()));
    const active = await runtime.runPromise(Effect.flatMap(LiveSessionService, (svc) => svc.list("active")));
    assert.equal(active.length, 0);
  } finally {
    await runtime.dispose();
  }
});
