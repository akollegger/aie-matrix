/**
 * Minimal reproducible test for the multiple-active-sessions crash.
 *
 * Reproduces the production outage of 2026-06-24: when the server pod is
 * rescheduled and Neo4j contains >1 active LiveSession, server/src/index.ts
 * calls process.exit(1) — crashing the pod and causing a CrashLoopBackOff.
 *
 * The fix: instead of exiting, pick the most recent active session and log a
 * warning (same policy as LocalLiveSessionService.ensure()).
 *
 * Note: LocalLiveSessionService enforces a single-session invariant, so these
 * tests drive the startup binding logic directly using mock session data rather
 * than trying to create two sessions through the in-memory service.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRecord } from "../src/live/LiveSessionService.js";

function makeSession(id: string, startedAt: string): SessionRecord {
  return {
    id,
    name: id,
    status: "active",
    startedAt,
    world: { name: "matrix" },
    maps: [],
  };
}

/**
 * Mirrors the CURRENT (buggy) session-binding logic from server/src/index.ts:646-654.
 * Returns { action: "exit" } instead of calling process.exit(1).
 */
function currentStartupBinding(
  sessions: readonly SessionRecord[],
  liveSessionId?: string,
): { action: "exit" } | { action: "bind"; id: string } | { action: "none" } {
  if (liveSessionId) {
    return { action: "bind", id: liveSessionId };
  }
  if (sessions.length === 1) {
    return { action: "bind", id: sessions[0]!.id };
  } else if (sessions.length > 1) {
    // BUG: calls process.exit(1) in production
    return { action: "exit" };
  }
  return { action: "none" };
}

/**
 * Mirrors the FIXED session-binding logic: picks most recent instead of exiting.
 */
function fixedStartupBinding(
  sessions: readonly SessionRecord[],
  liveSessionId?: string,
): { action: "exit" } | { action: "bind"; id: string } | { action: "none" } {
  if (liveSessionId) {
    return { action: "bind", id: liveSessionId };
  }
  if (sessions.length === 1) {
    return { action: "bind", id: sessions[0]!.id };
  } else if (sessions.length > 1) {
    const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { action: "bind", id: sorted[0]!.id };
  }
  return { action: "none" };
}

// ── Tests that REPRODUCE the bug ──────────────────────────────────────────────

test("[BUG] two active sessions causes server startup to exit (reproduces 2026-06-24 outage)", () => {
  const sessions = [
    makeSession("deploy-8e89983", "2026-06-24T10:00:00.000Z"),
    makeSession("deploy-main", "2026-06-24T10:30:00.000Z"),
  ];
  const result = currentStartupBinding(sessions);
  // Confirms the bug: two sessions → exit (was process.exit(1) in production)
  assert.equal(result.action, "exit", "BUG: two sessions causes server to exit");
});

// ── Tests for the FIXED behaviour ─────────────────────────────────────────────

test("[FIX] two active sessions should bind to most recent, not exit", () => {
  const sessions = [
    makeSession("deploy-8e89983", "2026-06-24T10:00:00.000Z"),
    makeSession("deploy-main", "2026-06-24T10:30:00.000Z"),
  ];
  const result = fixedStartupBinding(sessions);
  assert.notEqual(result.action, "exit", "should not exit with multiple sessions");
  assert.equal(result.action, "bind");
  if (result.action === "bind") {
    assert.equal(result.id, "deploy-main", "should bind to the most recent session");
  }
});

test("[FIX] one active session still binds correctly", () => {
  const sessions = [makeSession("deploy-main", "2026-06-24T10:30:00.000Z")];
  const result = fixedStartupBinding(sessions);
  assert.equal(result.action, "bind");
  if (result.action === "bind") {
    assert.equal(result.id, "deploy-main");
  }
});

test("[FIX] zero active sessions starts without binding", () => {
  const result = fixedStartupBinding([]);
  assert.equal(result.action, "none");
});

test("[FIX] explicit LIVE_SESSION_ID always wins regardless of session count", () => {
  const sessions = [
    makeSession("deploy-8e89983", "2026-06-24T10:00:00.000Z"),
    makeSession("deploy-main", "2026-06-24T10:30:00.000Z"),
  ];
  const result = fixedStartupBinding(sessions, "explicit-session-id");
  assert.equal(result.action, "bind");
  if (result.action === "bind") {
    assert.equal(result.id, "explicit-session-id");
  }
});
