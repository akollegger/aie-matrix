import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import { AgentExecutor, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import { Effect, Fiber, Duration } from "effect";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { SpawnContext } from "./spawn-types.js";
import { asWorldEvent } from "./world-event.js";
import type { NpcAgentCatalog, CharacterDefinition, DialogState } from "./types.js";
import type { RosterCredential } from "./roster/spawn-roster.js";
import { spawnRoster } from "./roster/spawn-roster.js";
import { evaluateRules, buildSnapshot } from "./behavior/rule-engine.js";
import { evaluateDialog, initialDialogState } from "./dialog/dialog-engine.js";

const ACTION_TICK_MS = 3000;

/** Per-character ghost fiber handles. Keyed by ghostId. */
const actionFibersByGhostId = new Map<string, Fiber.RuntimeFiber<void, never>>();

/** Active MCP clients per ghostId (set during fiber acquire, cleared during release). */
const mcpByGhostId = new Map<string, GhostMcpClient>();

/**
 * Per-partner dialog state. Key: `${characterGhostId}:${partnerGhostId}`.
 * Exported via getDialogStateSnapshot() for the _tck/dialog endpoint.
 */
const dialogStateMap = new Map<string, DialogState>();

function dialogKey(characterGhostId: string, partnerGhostId: string): string {
  return `${characterGhostId}:${partnerGhostId}`;
}

/** Returns a serialisable snapshot of all active dialog states (keyed as above). */
export function getDialogStateSnapshot(): Record<string, DialogState> {
  return Object.fromEntries(dialogStateMap);
}

/** Runtime state shared across all executor invocations (one per agent process). */
export interface NpcExecutorState {
  /** Set once on first spawn-context receipt. */
  spawnCtx: SpawnContext | null;
  /** Set once after the first roster spawn. characterId → ghostId */
  ghostIdByCharacter: ReadonlyMap<string, string>;
}

const sharedState: NpcExecutorState = {
  spawnCtx: null,
  ghostIdByCharacter: new Map(),
};

/** Returns true if the given ghostId belongs to a spawned NPC character. */
function isNpcCharacterGhost(ghostId: string): boolean {
  for (const gid of sharedState.ghostIdByCharacter.values()) {
    if (gid === ghostId) return true;
  }
  return false;
}

/** Returns the CharacterDefinition for a spawned character ghost, or undefined. */
function characterForGhostId(ghostId: string): CharacterDefinition | undefined {
  for (const [charId, gid] of sharedState.ghostIdByCharacter) {
    if (gid === ghostId) return catalog?.byId.get(charId);
  }
  return undefined;
}

/** Dependency-injected by agent.ts after catalog is loaded. */
let catalog: NpcAgentCatalog | null = null;
let agentHostUrl = "";
let agentId = "";

export function initExecutor(opts: {
  catalog: NpcAgentCatalog;
  agentHostUrl: string;
  agentId: string;
}): void {
  catalog = opts.catalog;
  agentHostUrl = opts.agentHostUrl;
  agentId = opts.agentId;
}

export class NpcAgentExecutor implements AgentExecutor {
  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId: taskId,
      final: true,
      status: { state: "canceled", timestamp: new Date().toISOString() },
    } satisfies TaskStatusUpdateEvent);
  };

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, contextId, taskId, task } = requestContext;
    const tid = taskId ?? randomUUID();

    const sp = parseSpawnData(userMessage);
    if (sp) {
      await this.handleSpawnContext(sp, tid, contextId, task, eventBus);
      return;
    }

    const ev = asWorldEvent(userMessage);
    if (ev !== null) {
      acknowledgeEvent(tid, contextId, task, eventBus);
      if (ev.kind === "world.session.start") {
        const sessionId = (ev.payload as { sessionId?: string }).sessionId;
        if (typeof sessionId === "string") {
          await this.triggerRosterSpawn(sessionId);
        }
      } else if (ev.kind === "world.message.new") {
        const pl = ev.payload as {
          from?: string;
          priority?: string;
          text?: string;
        };
        const targetGhostId = ev.ghostId;
        const senderGhostId = typeof pl.from === "string" ? pl.from : null;
        const inboundText = typeof pl.text === "string" ? pl.text : null;
        const priority = typeof pl.priority === "string" ? pl.priority : "";

        if (
          senderGhostId &&
          inboundText &&
          (priority === "PARTNER" || priority === "DIRECT") &&
          isNpcCharacterGhost(targetGhostId) &&
          !isNpcCharacterGhost(senderGhostId) // FR-009: ignore sibling-NPC senders
        ) {
          void handleDialogMessage(targetGhostId, senderGhostId, inboundText).catch(
            (e: unknown) => {
              console.error(
                JSON.stringify({
                  kind: "npc-agent.dialog.error",
                  targetGhostId,
                  error: e instanceof Error ? e.message : String(e),
                }),
              );
            },
          );
        }
      }
      return;
    }

    if (userMessage && userText(userMessage).toLowerCase() === "healthcheck") {
      const reply: Message = {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        contextId,
        taskId: tid,
        parts: [{ kind: "text", text: "ok" }],
      };
      eventBus.publish(reply);
      eventBus.finished();
      return;
    }

    const reply: Message = {
      kind: "message",
      messageId: randomUUID(),
      role: "agent",
      contextId,
      taskId: tid,
      parts: [{ kind: "text", text: "noop" }],
    };
    eventBus.publish(reply);
    eventBus.finished();
  }

  private async handleSpawnContext(
    sp: SpawnContext,
    taskId: string,
    contextId: string | undefined,
    task: Task | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    publishTask(taskId, contextId, task, eventBus);
    publishWorking(taskId, contextId, eventBus);

    // Character ghost spawn — start the behavior action loop for this character.
    if (sp.ghostCard.characterId && catalog) {
      const characterDef = catalog.byId.get(sp.ghostCard.characterId);
      if (characterDef) {
        console.info(
          JSON.stringify({
            kind: "npc-agent.character.spawn-received",
            ghostId: sp.ghostId,
            characterId: sp.ghostCard.characterId,
          }),
        );
        // launchGhostLoop awaits interrupt of any prior loop, then forks the new fiber.
        await launchGhostLoop(sp, characterDef);
        publishCompleted(taskId, contextId, eventBus);
        return;
      }
    }

    // NPC-agent's own spawn — store context and trigger roster.
    sharedState.spawnCtx = sp;
    console.info(
      JSON.stringify({
        kind: "npc-agent.spawn-received",
        ghostId: sp.ghostId,
      }),
    );

    // On startup, check if a session is already active (ADR-0012 R3).
    const worldRootUrl = sp.worldEntryPoint;
    const activeSessions = await fetchActiveSessions(worldRootUrl);
    if (activeSessions.length > 0) {
      const sessionId = activeSessions[0]!.id;
      await this.triggerRosterSpawn(sessionId);
    } else {
      console.info(
        JSON.stringify({ kind: "npc-agent.spawn-received.no-active-session", ghostId: sp.ghostId }),
      );
    }

    publishCompleted(taskId, contextId, eventBus);
  }

  private async triggerRosterSpawn(sessionId: string): Promise<void> {
    const sp = sharedState.spawnCtx;
    if (!sp) {
      console.warn(JSON.stringify({ kind: "npc-agent.roster.no-spawn-ctx", sessionId }));
      return;
    }
    if (!catalog) {
      console.warn(JSON.stringify({ kind: "npc-agent.roster.no-catalog", sessionId }));
      return;
    }
    if (!agentHostUrl) {
      console.warn(JSON.stringify({ kind: "npc-agent.roster.no-agent-host-url", sessionId }));
      return;
    }

    const credential: RosterCredential = {
      mcpToken: sp.token,
      worldApiBaseUrl: sp.houseEndpoints.mcp,
      characterTokens: new Map(),
      agentId,
    };

    const result = await spawnRoster(
      agentHostUrl,
      agentId,
      sessionId,
      catalog,
      credential,
    );

    sharedState.ghostIdByCharacter = result.ghostIdByCharacter;
  }
}

// ── Dialog handler ────────────────────────────────────────────────────────────

async function handleDialogMessage(
  characterGhostId: string,
  partnerGhostId: string,
  inboundText: string,
): Promise<void> {
  const characterDef = characterForGhostId(characterGhostId);
  if (!characterDef) return;

  const mcp = mcpByGhostId.get(characterGhostId);
  if (!mcp) {
    console.warn(
      JSON.stringify({
        kind: "npc-agent.dialog.no-mcp-client",
        characterGhostId,
      }),
    );
    return;
  }

  const key = dialogKey(characterGhostId, partnerGhostId);
  const state = dialogStateMap.get(key) ?? initialDialogState(characterDef.dialogTree);

  const result = evaluateDialog(characterDef.dialogTree, state, inboundText);

  dialogStateMap.set(key, {
    currentNodeId: result.nextNodeId,
    lastUpdated: new Date().toISOString(),
  });

  await mcp.callTool("say", { content: result.response, to: partnerGhostId });
}

// ── Per-character action loop (Effect-based) ──────────────────────────────────

/**
 * Returns an Effect that connects an MCP client, runs behavior ticks every
 * ACTION_TICK_MS until interrupted, then disconnects. The MCP client is stored
 * in mcpByGhostId for use by the dialog handler while the fiber is alive.
 *
 * Tick failures are non-fatal (FR-005): logged and skipped; the loop continues.
 * Connect failures propagate to the outer catchAll and are logged.
 * Fiber interruption triggers the acquireRelease finalizer (disconnect + map cleanup).
 */
function ghostActionLoop(
  ctx: SpawnContext,
  characterDef: CharacterDefinition,
): Effect.Effect<void, never> {
  return Effect.scoped(
    Effect.gen(function* () {
      const mcp = yield* Effect.acquireRelease(
        // Acquire: connect and register client.
        Effect.tryPromise({
          try: async () => {
            const client = new GhostMcpClient({
              worldApiBaseUrl: ctx.houseEndpoints.mcp,
              token: ctx.token,
            });
            await client.connect();
            mcpByGhostId.set(ctx.ghostId, client);
            return client;
          },
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }),
        // Release: disconnect unconditionally on fiber exit or interruption.
        (client) =>
          Effect.promise(() =>
            client
              .disconnect()
              .catch(() => {})
              .then(() => {
                mcpByGhostId.delete(ctx.ghostId);
              }),
          ),
      );

      // Single tick: gather world state, evaluate behavior rules, then sleep.
      const tick = Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => {
            const whereami = (await mcp.callTool("whereami", {})) as Record<string, unknown>;
            const exitsRaw = (await mcp.callTool("exits", {})) as Record<string, unknown>;
            const inventoryRaw = (await mcp.callTool("inventory", {})) as Record<string, unknown>;
            const lookRaw = (await mcp.callTool("look", {})) as Record<string, unknown>;
            const snapshot = buildSnapshot(whereami, exitsRaw, inventoryRaw, lookRaw, ctx.ghostId);
            await evaluateRules(characterDef, snapshot, mcp);
          },
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }).pipe(
          // Tick failure is non-fatal: log and continue (FR-005).
          Effect.catchAll((e) =>
            Effect.sync(() =>
              console.warn(
                JSON.stringify({
                  kind: "npc-agent.character.tick-error",
                  ghostId: ctx.ghostId,
                  error: e instanceof Error ? e.message : String(e),
                }),
              ),
            ),
          ),
        );
        yield* Effect.sleep(Duration.millis(ACTION_TICK_MS));
      });

      yield* Effect.forever(tick);
    }),
  ).pipe(
    Effect.asVoid,
    Effect.catchAll((e) =>
      Effect.sync(() =>
        console.error(
          JSON.stringify({
            kind: "npc-agent.character.loop-error",
            ghostId: ctx.ghostId,
            error: e instanceof Error ? e.message : String(e),
          }),
        ),
      ),
    ),
  );
}

/**
 * Launch a ghost action loop as an Effect fiber. If a loop is already running
 * for the given ghostId, it is interrupted (and its MCP client disconnected)
 * before the new fiber starts.
 */
async function launchGhostLoop(
  ctx: SpawnContext,
  characterDef: CharacterDefinition,
): Promise<void> {
  const { ghostId } = ctx;

  const existing = actionFibersByGhostId.get(ghostId);
  if (existing) {
    console.info(
      JSON.stringify({ kind: "npc-agent.character.loop-cancel", ghostId, reason: "spawn-replace" }),
    );
    await Effect.runPromise(Fiber.interrupt(existing));
    actionFibersByGhostId.delete(ghostId);
  }

  const fiber = Effect.runFork(ghostActionLoop(ctx, characterDef));
  actionFibersByGhostId.set(ghostId, fiber);

  console.info(
    JSON.stringify({
      kind: "npc-agent.character.loop-start",
      ghostId,
      characterId: characterDef.id,
      tickMs: ACTION_TICK_MS,
    }),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSpawnData(msg: Message | undefined): SpawnContext | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.agent-host.spawn-context.v1") {
        return d as unknown as SpawnContext;
      }
    }
  }
  return null;
}

function userText(msg: Message): string {
  for (const p of msg.parts ?? []) {
    if (p.kind === "text" && "text" in p) return p.text;
  }
  return "";
}

function publishTask(
  taskId: string,
  contextId: string | undefined,
  task: Task | undefined,
  eventBus: ExecutionEventBus,
): void {
  if (!task) {
    const newTask: Task = {
      kind: "task",
      id: taskId,
      contextId: contextId ?? taskId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [],
      artifacts: [],
    };
    eventBus.publish(newTask);
  }
}

function publishWorking(
  taskId: string,
  contextId: string | undefined,
  eventBus: ExecutionEventBus,
): void {
  eventBus.publish({
    kind: "status-update",
    taskId,
    contextId: contextId ?? taskId,
    final: false,
    status: { state: "working", timestamp: new Date().toISOString() },
  } satisfies TaskStatusUpdateEvent);
}

function publishCompleted(
  taskId: string,
  contextId: string | undefined,
  eventBus: ExecutionEventBus,
): void {
  eventBus.publish({
    kind: "status-update",
    taskId,
    contextId: contextId ?? taskId,
    final: true,
    status: { state: "completed", timestamp: new Date().toISOString() },
  } satisfies TaskStatusUpdateEvent);
  eventBus.finished();
}

function acknowledgeEvent(
  tid: string,
  contextId: string | undefined,
  task: Task | undefined,
  eventBus: ExecutionEventBus,
): void {
  if (!task) {
    publishTask(tid, contextId, task, eventBus);
  }
  publishCompleted(tid, contextId, eventBus);
}

/** Fetch active live sessions from the world server. */
async function fetchActiveSessions(worldRootUrl: string): Promise<Array<{ id: string }>> {
  try {
    const res = await fetch(`${worldRootUrl}/live?status=active`);
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) return json as Array<{ id: string }>;
    return [];
  } catch {
    return [];
  }
}
