import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latLngToCell } from "h3-js";
import type { Message } from "@a2a-js/sdk";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import { RandomWandererExecutor } from "../src/executor.js";
import type { SpawnContext } from "../src/spawn-types.js";

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

function mkSpawnMessage(ctx: SpawnContext): Message {
  return {
    kind: "message",
    messageId: "m1",
    role: "user",
    contextId: "ctx-1",
    parts: [{ kind: "data", data: ctx as unknown as Record<string, unknown> }],
  };
}

function mkBus(): ExecutionEventBus {
  return {
    publish: vi.fn(),
    finished: vi.fn(),
  } as unknown as ExecutionEventBus;
}

function baseCtx(ghostId: string): SpawnContext {
  return {
    schema: "aie-matrix.ghost-house.spawn-context.v1",
    ghostId,
    houseEndpoints: { mcp: "http://127.0.0.1:9/mcp", a2a: "http://127.0.0.1:9/" },
    token: `tok-${ghostId}`,
    worldEntryPoint: "w",
    ghostCard: { class: "wanderer", displayName: "g", partnerEmail: null },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe("RandomWandererExecutor movement registry", () => {
  beforeEach(() => {
    mcpInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps two distinct ghostId loops active (second spawn does not cancel the first)", async () => {
    const slow = () => "5000";
    const ex = new RandomWandererExecutor(slow);
    const ctxA = baseCtx("ghost-a");
    const ctxB = baseCtx("ghost-b");
    const rcA = {
      userMessage: mkSpawnMessage(ctxA),
      taskId: "task-a",
      contextId: "ctx-a",
    } as RequestContext;
    const rcB = {
      userMessage: mkSpawnMessage(ctxB),
      taskId: "task-b",
      contextId: "ctx-b",
    } as RequestContext;
    await ex.execute(rcA, mkBus());
    await ex.execute(rcB, mkBus());
    await vi.waitFor(() => mcpInstances.length >= 2);
    expect(mcpInstances.length).toBe(2);
    expect(mcpInstances[0].disconnect).not.toHaveBeenCalled();
    expect(mcpInstances[1].disconnect).not.toHaveBeenCalled();
    await ex.cancelTask("task-a", mkBus());
    await vi.waitFor(() => mcpInstances[0].disconnect.mock.calls.length >= 1);
    expect(mcpInstances[1].disconnect).not.toHaveBeenCalled();
  });

  it("re-spawn for the same ghostId disconnects the previous MCP client only for that ghost", async () => {
    const slow = () => "60000";
    const ex = new RandomWandererExecutor(slow);
    const ghostId = "ghost-same";
    const ctx1 = baseCtx(ghostId);
    const ctx2 = { ...baseCtx(ghostId), token: "tok-replaced" };
    await ex.execute(
      {
        userMessage: mkSpawnMessage(ctx1),
        taskId: "task-1",
        contextId: "ctx-1",
      } as RequestContext,
      mkBus(),
    );
    await vi.waitFor(() => mcpInstances.length >= 1);
    await ex.execute(
      {
        userMessage: mkSpawnMessage(ctx2),
        taskId: "task-2",
        contextId: "ctx-2",
      } as RequestContext,
      mkBus(),
    );
    await vi.waitFor(() => mcpInstances.length >= 2);
    await vi.waitFor(() => mcpInstances[0].disconnect.mock.calls.length >= 1);
    expect(mcpInstances.length).toBe(2);
    expect(mcpInstances[1].disconnect).not.toHaveBeenCalled();
  });
});
