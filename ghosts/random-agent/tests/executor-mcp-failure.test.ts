import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latLngToCell } from "h3-js";
import type { Message, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import { RandomWandererExecutor } from "../src/executor.js";
import type { SpawnContext } from "../src/spawn-types.js";

const RES15 = latLngToCell(37.7749, -122.4194, 15);

type MockMcp = { callTool: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
const mcpInstances: MockMcp[] = [];

vi.mock("@aie-matrix/ghost-ts-client", () => ({
  GhostMcpClient: class {
    connect = vi.fn(async () => {});
    disconnect = vi.fn(async () => {});
    announce = vi.fn(async () => {});
    callTool = vi.fn(async () => ({
      h3Index: RES15,
      exits: [{ toward: "n" }],
      ok: true,
      tileId: RES15,
    }));
    constructor() {
      mcpInstances.push(this as unknown as MockMcp);
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

function mkBus(): { bus: ExecutionEventBus; published: TaskStatusUpdateEvent[] } {
  const published: TaskStatusUpdateEvent[] = [];
  const bus = {
    publish: vi.fn((e: unknown) => {
      if (typeof e === "object" && e !== null && "kind" in e && (e as { kind: string }).kind === "status-update") {
        published.push(e as TaskStatusUpdateEvent);
      }
    }),
    finished: vi.fn(),
  } as unknown as ExecutionEventBus;
  return { bus, published };
}

function baseCtx(ghostId: string): SpawnContext {
  return {
    schema: "aie-matrix.agent-host.spawn-context.v1",
    ghostId,
    houseEndpoints: { mcp: "http://127.0.0.1:9/mcp", a2a: "http://127.0.0.1:9/" },
    token: `tok-${ghostId}`,
    worldEntryPoint: "w",
    ghostCard: { class: "wanderer", displayName: "Test Wanderer", partnerEmail: null },
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

describe("RandomWandererExecutor MCP failure → re-spawn signal", () => {
  beforeEach(() => {
    mcpInstances.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("publishes 'failed' (not 'completed') when whereami fails 3 times consecutively", async () => {
    const ex = new RandomWandererExecutor(() => "100", () => 10);
    const ctx = baseCtx("ghost-mcp-fail");
    const { bus, published } = mkBus();

    // Start execute so GhostMcpClient is constructed, then make callTool always fail
    const done = ex.execute(
      { userMessage: mkSpawnMessage(ctx), taskId: "task-fail", contextId: "ctx-fail" } as RequestContext,
      bus,
    );

    // Wait for the MCP client to be instantiated, then override callTool to throw
    await vi.waitFor(() => mcpInstances.length >= 1);
    mcpInstances[0]!.callTool.mockRejectedValue(new Error("Streamable HTTP error: terminated"));

    await done;

    const terminal = published.find((e) => e.final);
    expect(terminal).toBeDefined();
    expect(terminal?.status.state).toBe("failed");
  }, 10_000);

  it("publishes 'canceled' on clean cancellation (not an error)", async () => {
    const ex = new RandomWandererExecutor(() => "100", () => 10);
    const ctx = baseCtx("ghost-clean-cancel");
    const { bus, published } = mkBus();

    const done = ex.execute(
      { userMessage: mkSpawnMessage(ctx), taskId: "task-cancel", contextId: "ctx-cancel" } as RequestContext,
      bus,
    );

    // Wait for the loop to reach "working" state, then cancel
    await vi.waitFor(() => published.some((e) => e.status.state === "working"), { timeout: 3_000 });
    await ex.cancelTask("task-cancel", bus);
    await done;

    const terminal = published.find((e) => e.final);
    expect(terminal).toBeDefined();
    expect(terminal?.status.state).toBe("canceled");
  }, 10_000);
});
