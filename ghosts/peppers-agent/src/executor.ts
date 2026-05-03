import { randomUUID } from "node:crypto";
import type { Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import { samplePersonality } from "@aie-matrix/ghost-peppers-inner";
import { runHouse } from "./run-house.js";
import type { SpawnContext } from "./spawn-types.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}; check .env at repo root`);
  return v;
}

function parseSpawnContext(msg: import("@a2a-js/sdk").Message | undefined): SpawnContext | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.ghost-house.spawn-context.v1") {
        return d as unknown as SpawnContext;
      }
    }
  }
  return null;
}

const loopAbortControllers = new Map<string, AbortController>();

export class PeppersAgentExecutor implements AgentExecutor {
  execute = async (requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const { userMessage, contextId, taskId, task } = requestContext;
    const tid = taskId ?? randomUUID();

    const t: Task = task ?? {
      kind: "task",
      id: tid,
      contextId,
      status: { state: "submitted" as const, timestamp: new Date().toISOString() },
      history: userMessage ? [userMessage] : [],
      artifacts: [],
    };
    if (!task) eventBus.publish(t);

    const ctx = parseSpawnContext(userMessage);
    if (!ctx) {
      const failed: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: t.id,
        contextId: contextId ?? t.contextId,
        final: true,
        status: { state: "failed", timestamp: new Date().toISOString() },
      };
      eventBus.publish(failed);
      eventBus.finished();
      return;
    }

    const { ghostId } = ctx;
    const prev = loopAbortControllers.get(ghostId);
    if (prev) prev.abort();
    const ac = new AbortController();
    loopAbortControllers.set(ghostId, ac);

    const working: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId: t.id,
      contextId: contextId ?? t.contextId,
      final: false,
      status: { state: "working", timestamp: new Date().toISOString() },
    };
    eventBus.publish(working);

    const memoryConnection = {
      uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
      username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
      password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
      database: process.env.GHOST_MINDS_NEO4J_DATABASE,
    };

    const objective =
      process.env.PEPPERS_OBJECTIVE ??
      "Make friends with as many other ghosts as you can. When a ghost is nearby in your cluster, speak to them — say hello, share something, ask what they're thinking, find common ground.";

    const seedEnv = process.env.PEPPERS_BIRTH_SEED;
    const seed = seedEnv ? Number(seedEnv) : Math.floor(Math.random() * 2 ** 31);
    const initialPersonality = samplePersonality({ seed, stddev: 1.8 });

    // Run the personality loop in background; keep the task open (final: false)
    // so ghost-house can send world events to this task while the loop runs.
    void runHouse({
      registryBase: ctx.houseEndpoints.a2a,
      memoryConnection,
      initialPersonality,
      objective,
      verbose: process.env.PEPPERS_VERBOSE === "1",
      preProvisionedGhost: {
        ghostId: ctx.ghostId,
        worldApiBaseUrl: ctx.houseEndpoints.mcp,
        token: ctx.token,
      },
    })
      .then(() => {
        if (ac.signal.aborted) return;
        loopAbortControllers.delete(ghostId);
        const done: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId: t.id,
          contextId: contextId ?? t.contextId,
          final: true,
          status: { state: "completed", timestamp: new Date().toISOString() },
        };
        eventBus.publish(done);
        eventBus.finished();
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        loopAbortControllers.delete(ghostId);
        console.error(
          JSON.stringify({ kind: "peppers-agent.loop-error", ghostId, message: err instanceof Error ? err.message : String(err) }),
        );
        const failed: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId: t.id,
          contextId: contextId ?? t.contextId,
          final: true,
          status: { state: "failed", timestamp: new Date().toISOString() },
        };
        eventBus.publish(failed);
        eventBus.finished();
      });

    // Return immediately; the task stays open (status: working, final: false)
    // so ghost-house can push world events while the loop runs.
  };

  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    const canceled: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId: "",
      final: true,
      status: { state: "canceled", timestamp: new Date().toISOString() },
    };
    eventBus.publish(canceled);
  };
}
