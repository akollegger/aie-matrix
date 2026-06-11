import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Effect, Fiber } from "effect";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { _test } from "../src/executor.js";
import type { SpawnContext } from "../src/spawn-types.js";
import type { CharacterDefinition } from "../src/types.js";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@aie-matrix/ghost-ts-client", () => ({
  GhostMcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue({}),
  })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSpawnCtx(ghostId: string): SpawnContext {
  return {
    schema: "aie-matrix.agent-host.spawn-context.v1",
    ghostId,
    token: "test-token",
    worldEntryPoint: "http://localhost:3000",
    houseEndpoints: { mcp: "http://localhost:3000/mcp", a2a: "http://localhost:3000/a2a" },
    ghostCard: {
      class: "npc",
      displayName: `Ghost ${ghostId}`,
      partnerEmail: null,
      characterId: `char-${ghostId}`,
    },
    expiresAt: "2099-01-01T00:00:00Z",
  };
}

function makeCharDef(id: string): CharacterDefinition {
  return {
    id,
    name: `Character ${id}`,
    background: "test background",
    enabled: true,
    defaultAction: { do: "idle" as const },
    behaviorRules: [],
    dialogTree: {
      id: "dialog_1",
      rootId: "idle",
      nodes: new Map([["idle", { id: "idle", responses: ["Hello!"] }]]),
      edges: [{ fromId: "idle", toId: "idle", triggers: [] }],
    },
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear accumulated call counts and reset GhostMcpClient to happy-path.
  vi.clearAllMocks();
  vi.mocked(GhostMcpClient).mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue({}),
  }));
  _test.resetTickMs();
});

afterEach(async () => {
  // Interrupt all fibers and clear module state between tests.
  await _test.interruptAll();
});

// ── Area 1: Many simultaneous fibers ─────────────────────────────────────────

describe("concurrent fiber management", () => {
  it("launches 20 independent fibers without interference", async () => {
    const N = 20;
    for (let i = 0; i < N; i++) {
      await _test.launchGhostLoop(makeSpawnCtx(`ghost-${i}`), makeCharDef(`char-${i}`));
    }

    expect(_test.activeFiberCount()).toBe(N);
  });

  it("each ghost gets its own MCP client instance", async () => {
    const N = 10;
    for (let i = 0; i < N; i++) {
      await _test.launchGhostLoop(makeSpawnCtx(`ghost-${i}`), makeCharDef(`char-${i}`));
    }

    // GhostMcpClient constructor should have been called once per ghost.
    expect(vi.mocked(GhostMcpClient)).toHaveBeenCalledTimes(N);
  });

  it("interrupting all fibers clears the active count to zero", async () => {
    for (let i = 0; i < 15; i++) {
      await _test.launchGhostLoop(makeSpawnCtx(`ghost-${i}`), makeCharDef(`char-${i}`));
    }
    expect(_test.activeFiberCount()).toBe(15);

    await _test.interruptAll();
    expect(_test.activeFiberCount()).toBe(0);
  });
});

// ── Area 2: Spawn-replace lifecycle ──────────────────────────────────────────

describe("spawn-replace fiber lifecycle", () => {
  it("re-spawning the same ghostId replaces the existing fiber", async () => {
    const ctx = makeSpawnCtx("ghost-replace");

    await _test.launchGhostLoop(ctx, makeCharDef("char-v1"));
    const firstFiber = _test.getFiber("ghost-replace")!;
    expect(_test.activeFiberCount()).toBe(1);

    await _test.launchGhostLoop(ctx, makeCharDef("char-v2"));
    const secondFiber = _test.getFiber("ghost-replace")!;

    expect(_test.activeFiberCount()).toBe(1);
    expect(secondFiber).not.toBe(firstFiber);
  });

  it("the first fiber is interrupted (poll shows done) after re-spawn", async () => {
    const ctx = makeSpawnCtx("ghost-interrupt-check");

    await _test.launchGhostLoop(ctx, makeCharDef("char-v1"));
    const firstFiber = _test.getFiber("ghost-interrupt-check")!;

    await _test.launchGhostLoop(ctx, makeCharDef("char-v2"));

    const poll = await Effect.runPromise(Fiber.poll(firstFiber));
    // Some(_) means the fiber has an exit value — it was interrupted or completed.
    expect(poll._tag).toBe("Some");
  });

  it("10 rapid sequential re-spawns leave exactly 1 fiber alive", async () => {
    const ctx = makeSpawnCtx("ghost-rapid");

    for (let i = 0; i < 10; i++) {
      await _test.launchGhostLoop(ctx, makeCharDef(`char-v${i}`));
    }

    expect(_test.activeFiberCount()).toBe(1);
  });

  it("different ghostIds each maintain their own fiber slot", async () => {
    await _test.launchGhostLoop(makeSpawnCtx("ghost-a"), makeCharDef("char-a"));
    await _test.launchGhostLoop(makeSpawnCtx("ghost-b"), makeCharDef("char-b"));
    await _test.launchGhostLoop(makeSpawnCtx("ghost-a"), makeCharDef("char-a-v2")); // replaces ghost-a only

    expect(_test.activeFiberCount()).toBe(2); // ghost-a (new) + ghost-b (original)
  });
});

// ── Area 3: MCP connect failure ───────────────────────────────────────────────

describe("MCP connect failure", () => {
  it("connect failure causes the loop to exit, not hang", async () => {
    vi.mocked(GhostMcpClient).mockImplementationOnce(() => ({
      connect: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      disconnect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn(),
    }));

    await _test.launchGhostLoop(makeSpawnCtx("ghost-cf"), makeCharDef("char-cf"));
    const fiber = _test.getFiber("ghost-cf")!;

    // Give the fiber time to attempt connect, fail, log, and exit.
    await new Promise((r) => setTimeout(r, 100));

    // Fiber should have exited — poll returns Some(_) for a completed/interrupted fiber.
    const poll = await Effect.runPromise(Fiber.poll(fiber));
    expect(poll._tag).toBe("Some");
  });

  it("connect failure for one ghost does not affect sibling fibers", async () => {
    // ghost-good connects normally (uses default beforeEach mock).
    await _test.launchGhostLoop(makeSpawnCtx("ghost-good"), makeCharDef("char-good"));

    // ghost-bad fails to connect (mockImplementationOnce — next constructor call).
    vi.mocked(GhostMcpClient).mockImplementationOnce(() => ({
      connect: vi.fn().mockRejectedValue(new Error("connect refused")),
      disconnect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn(),
    }));
    await _test.launchGhostLoop(makeSpawnCtx("ghost-bad"), makeCharDef("char-bad"));

    await new Promise((r) => setTimeout(r, 100));

    const goodFiber = _test.getFiber("ghost-good")!;
    const goodPoll = await Effect.runPromise(Fiber.poll(goodFiber));
    // ghost-good is still sleeping in its tick loop — poll returns None.
    expect(goodPoll._tag).toBe("None");

    const badFiber = _test.getFiber("ghost-bad")!;
    const badPoll = await Effect.runPromise(Fiber.poll(badFiber));
    // ghost-bad exited after connect failed.
    expect(badPoll._tag).toBe("Some");
  });
});

// ── Area 4: Tick error resilience ────────────────────────────────────────────

describe("tick error resilience", () => {
  it("MCP callTool failures are non-fatal — fiber survives after a failed tick", async () => {
    vi.mocked(GhostMcpClient).mockImplementationOnce(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn().mockRejectedValue(new Error("tool unavailable")),
    }));

    _test.setTickMs(50); // fast tick so the first tick fires well within 200ms
    await _test.launchGhostLoop(makeSpawnCtx("ghost-tick-fail"), makeCharDef("char-tf"));
    const fiber = _test.getFiber("ghost-tick-fail")!;

    // Wait for at least one tick to attempt, fail, and sleep again.
    await new Promise((r) => setTimeout(r, 200));

    // Fiber must still be alive — tick errors are non-fatal (FR-005).
    const poll = await Effect.runPromise(Fiber.poll(fiber));
    expect(poll._tag).toBe("None");
  });

  it("fiber survives multiple consecutive tick failures", async () => {
    let callCount = 0;
    vi.mocked(GhostMcpClient).mockImplementationOnce(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn().mockImplementation(async () => {
        callCount++;
        throw new Error("persistent failure");
      }),
    }));

    _test.setTickMs(40);
    await _test.launchGhostLoop(makeSpawnCtx("ghost-multi-fail"), makeCharDef("char-mf"));
    const fiber = _test.getFiber("ghost-multi-fail")!;

    // Wait for ~5 ticks worth of time.
    await new Promise((r) => setTimeout(r, 250));

    // Multiple tick failures should have occurred.
    expect(callCount).toBeGreaterThanOrEqual(3);

    // Fiber is still running.
    const poll = await Effect.runPromise(Fiber.poll(fiber));
    expect(poll._tag).toBe("None");
  });

  it("MCP client is disconnected when fiber is interrupted, even after tick failures", async () => {
    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    vi.mocked(GhostMcpClient).mockImplementationOnce(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: mockDisconnect,
      callTool: vi.fn().mockRejectedValue(new Error("tool error")),
    }));

    _test.setTickMs(50);
    await _test.launchGhostLoop(makeSpawnCtx("ghost-disconnect"), makeCharDef("char-dc"));

    await new Promise((r) => setTimeout(r, 150));
    await _test.interruptAll();

    // acquireRelease finalizer must have run — disconnect called exactly once.
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
