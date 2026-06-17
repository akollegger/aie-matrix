/**
 * Verifies that the executor responds to world.message.new events regardless
 * of whether the priority is "PARTNER" (HTTP /conversations path) or "DIRECT"
 * (MCP say tool path — the Intermedium chat overlay).
 *
 * Regression test for: random-agent silently dropped all chat messages sent
 * via the Intermedium overlay because the overlay uses DIRECT priority and the
 * executor only checked for PARTNER.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latLngToCell } from "h3-js";
import type { Message } from "@a2a-js/sdk";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import { RandomWandererExecutor } from "../src/executor.js";
import type { SpawnContext } from "../src/spawn-types.js";
import type { WorldEvent } from "../src/world-event.js";

const RES15 = latLngToCell(37.7749, -122.4194, 15);

type MockMcp = {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
};

const mcpInstances: MockMcp[] = [];

vi.mock("@aie-matrix/ghost-ts-client", () => ({
  GhostMcpClient: class {
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    announce = vi.fn(async () => {});
    callTool = vi.fn(async () => ({
      h3Index: RES15,
      exits: [{ toward: RES15 }],
      ok: true,
      tileId: RES15,
    }));
    constructor() {
      mcpInstances.push(this);
    }
  },
}));

function mkBus(): ExecutionEventBus {
  return { publish: vi.fn(), finished: vi.fn() } as unknown as ExecutionEventBus;
}

function mkSpawnMessage(ghostId: string): Message {
  const ctx: SpawnContext = {
    schema: "aie-matrix.agent-host.spawn-context.v1",
    ghostId,
    houseEndpoints: { mcp: "http://127.0.0.1:9/mcp", a2a: "http://127.0.0.1:9/", registry: "http://127.0.0.1:9" },
    token: `tok-${ghostId}`,
    worldEntryPoint: RES15,
    ghostCard: { class: "wanderer", displayName: "tester", partnerEmail: null },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  return {
    kind: "message",
    messageId: "m-spawn",
    role: "user",
    contextId: "ctx-spawn",
    parts: [{ kind: "data", data: ctx as unknown as Record<string, unknown> }],
  };
}

function mkWorldEventMessage(ghostId: string, priority: string, fromGhostId = "human-ghost"): Message {
  const ev: WorldEvent = {
    schema: "aie-matrix.world-event.v1",
    kind: "world.message.new",
    ghostId,
    eventId: "evt-1",
    sentAt: new Date().toISOString(),
    payload: {
      from: fromGhostId,
      role: "partner",
      priority,
      text: "hello?",
      intent: "chat",
    },
  };
  return {
    kind: "message",
    messageId: "m-event",
    role: "user",
    contextId: "ctx-event",
    parts: [{ kind: "data", data: ev as unknown as Record<string, unknown> }],
  };
}

describe("RandomWandererExecutor — message priority handling", () => {
  beforeEach(() => {
    mcpInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("responds to PARTNER priority (original HTTP /conversations path)", async () => {
    const ex = new RandomWandererExecutor(() => "60000");
    const ghostId = "ghost-partner";

    void ex.execute(
      { userMessage: mkSpawnMessage(ghostId), taskId: "t-spawn", contextId: "ctx-1" } as RequestContext,
      mkBus(),
    );
    // Wait for MCP client to be wired up and registered
    await vi.waitFor(() => mcpInstances.length >= 1);
    await vi.waitFor(() => expect(mcpInstances[0].connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mcpInstances[0].announce).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));

    void ex.execute(
      { userMessage: mkWorldEventMessage(ghostId, "PARTNER"), taskId: "t-msg", contextId: "ctx-2" } as RequestContext,
      mkBus(),
    );

    await vi.waitFor(() => {
      const mcp = mcpInstances[0];
      return mcp?.callTool.mock.calls.some((args) => args[0] === "say");
    });

    const sayCalls = mcpInstances[0]!.callTool.mock.calls.filter((a) => a[0] === "say");
    expect(sayCalls.length).toBeGreaterThanOrEqual(1);
    expect(sayCalls[0][1]).toMatchObject({ to: "human-ghost" });
  });

  it("responds to DIRECT priority (MCP say tool — Intermedium chat overlay path)", async () => {
    const ex = new RandomWandererExecutor(() => "60000");
    const ghostId = "ghost-direct";

    void ex.execute(
      { userMessage: mkSpawnMessage(ghostId), taskId: "t-spawn", contextId: "ctx-3" } as RequestContext,
      mkBus(),
    );
    // Wait for MCP client to be wired up and registered
    await vi.waitFor(() => mcpInstances.length >= 1);
    await vi.waitFor(() => expect(mcpInstances[0].connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mcpInstances[0].announce).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));

    void ex.execute(
      { userMessage: mkWorldEventMessage(ghostId, "DIRECT"), taskId: "t-msg2", contextId: "ctx-4" } as RequestContext,
      mkBus(),
    );

    await vi.waitFor(() => {
      const mcp = mcpInstances[0];
      return mcp?.callTool.mock.calls.some((args) => args[0] === "say");
    });

    const sayCalls = mcpInstances[0]!.callTool.mock.calls.filter((a) => a[0] === "say");
    expect(sayCalls.length).toBeGreaterThanOrEqual(1);
    expect(sayCalls[0][1]).toMatchObject({ to: "human-ghost" });
  });

  it("does NOT respond to NEAR priority (broadcast — no direct reply expected)", async () => {
    const ex = new RandomWandererExecutor(() => "60000");
    const ghostId = "ghost-near";

    void ex.execute(
      { userMessage: mkSpawnMessage(ghostId), taskId: "t-spawn2", contextId: "ctx-5" } as RequestContext,
      mkBus(),
    );
    // Wait for MCP client to be wired up and registered
    await vi.waitFor(() => mcpInstances.length >= 1);
    await vi.waitFor(() => expect(mcpInstances[0].connect).toHaveBeenCalled());
    await vi.waitFor(() => expect(mcpInstances[0].announce).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));

    const mcp = mcpInstances[0]!;
    // Clear any say calls from the spawn tick
    mcp.callTool.mockClear();

    void ex.execute(
      { userMessage: mkWorldEventMessage(ghostId, "NEAR"), taskId: "t-msg3", contextId: "ctx-6" } as RequestContext,
      mkBus(),
    );

    // Small wait — no say call should be triggered
    await new Promise((r) => setTimeout(r, 80));
    const sayCalls = mcp.callTool.mock.calls.filter((a) => a[0] === "say");
    expect(sayCalls.length).toBe(0);
  });
});
