import { createLogger } from "@aie-matrix/logger";
import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import { AgentExecutor, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import { Effect, Fiber, Duration, Match } from "effect";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { SpawnContext } from "./spawn-types.js";
import { asWorldEvent, type WorldEvent } from "./world-event.js";
import type { NpcAgentCatalog, CharacterDefinition, DialogState } from "./types.js";
import { GhostMcpServiceLive } from "./mcp-effect.js";
import { ruleEngineTick } from "./behavior/rule-engine.js";
import { evaluateDialog, initialDialogState } from "./dialog/dialog-engine.js";
import {
  brokerTick,
  brokerHandleAccept,
  handleContractSubmitted,
  clearBrokerState,
  getBrokerGhostIdForContract,
} from "./behavior/broker-behavior.js";

const log = createLogger("npc-agent");

const ACTION_TICK_MS = 3000;

// Placeholder until issue #49 resolves the say.intent model.
// https://github.com/akollegger/aie-matrix/issues/49
const DEFAULT_INTENT = "greet";
/** Mutable tick interval — overridden by tests via _test.setTickMs(). Production value is ACTION_TICK_MS. */
let _tickMs = ACTION_TICK_MS;

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
  /** characterId → ghostId for all spawned character ghosts. */
  ghostIdByCharacter: ReadonlyMap<string, string>;
}

const sharedState: NpcExecutorState = {
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

export function initExecutor(opts: {
  catalog: NpcAgentCatalog;
  agentHostUrl: string;
  agentId: string;
}): void {
  catalog = opts.catalog;
}

// ── Incoming message classification ──────────────────────────────────────────

type ParsedMessage =
  | { readonly _tag: "spawn";       readonly ctx: SpawnContext }
  | { readonly _tag: "worldEvent";  readonly ev: WorldEvent }
  | { readonly _tag: "healthcheck" }
  | { readonly _tag: "noop" };

function classifyMessage(msg: Message | undefined): ParsedMessage {
  const sp = parseSpawnData(msg);
  if (sp) return { _tag: "spawn", ctx: sp };

  const ev = asWorldEvent(msg);
  if (ev !== null) return { _tag: "worldEvent", ev };

  if (msg && userText(msg).toLowerCase() === "healthcheck") return { _tag: "healthcheck" };

  return { _tag: "noop" };
}

// ── Executor ─────────────────────────────────────────────────────────────────

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

    await Match.value(classifyMessage(userMessage)).pipe(
      Match.when({ _tag: "spawn" as const },       ({ ctx }) => this.handleSpawnContext(ctx, tid, contextId, task, eventBus)),
      Match.when({ _tag: "worldEvent" as const },  ({ ev })  => this.handleWorldEvent(ev, tid, contextId, task, eventBus)),
      Match.when({ _tag: "healthcheck" as const }, ()        => this.handleHealthcheck(tid, contextId, eventBus)),
      Match.when({ _tag: "noop" as const },        ()        => this.handleNoop(tid, contextId, eventBus)),
      Match.exhaustive,
    );
  }

  private handleHealthcheck(tid: string, contextId: string | undefined, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish({
      kind: "message",
      messageId: randomUUID(),
      role: "agent",
      contextId,
      taskId: tid,
      parts: [{ kind: "text", text: "ok" }],
    } satisfies Message);
    eventBus.finished();
    return Promise.resolve();
  }

  private handleNoop(tid: string, contextId: string | undefined, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish({
      kind: "message",
      messageId: randomUUID(),
      role: "agent",
      contextId,
      taskId: tid,
      parts: [{ kind: "text", text: "noop" }],
    } satisfies Message);
    eventBus.finished();
    return Promise.resolve();
  }

  private async handleWorldEvent(
    ev: WorldEvent,
    tid: string,
    contextId: string | undefined,
    task: Task | undefined,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    acknowledgeEvent(tid, contextId, task, eventBus);

    await Match.value(ev).pipe(
      Match.when({ kind: "world.session.start" as const }, () =>
        // Agent-host now handles roster re-spawning on session.start.
        Promise.resolve(),
      ),
      Match.when({ kind: "world.contract.submitted" as const }, (e) => {
        const { contractId, contractorId } = e.payload;
        const brokerGhostId = getBrokerGhostIdForContract(contractId);
        const brokerMcp = brokerGhostId ? mcpByGhostId.get(brokerGhostId) : undefined;
        if (brokerMcp) {
          void Effect.runPromise(
            handleContractSubmitted(contractId, contractorId).pipe(
              Effect.provide(GhostMcpServiceLive(brokerMcp)),
            ),
          ).catch((e: unknown) => {
            console.error(JSON.stringify({
              kind: "npc-agent.broker.contract-submitted-error",
              contractId,
              error: e instanceof Error ? e.message : String(e),
            }));
          });
        }
        return Promise.resolve();
      }),
      Match.when({ kind: "world.message.new" as const }, (e) => {
        const { from, text, priority } = e.payload;
        if (
          (priority === "PARTNER" || priority === "DIRECT") &&
          isNpcCharacterGhost(e.ghostId) &&
          !isNpcCharacterGhost(from) // FR-009: ignore sibling-NPC senders
        ) {
          const characterDef = characterForGhostId(e.ghostId);
          const brokerMcp = mcpByGhostId.get(e.ghostId);
          if (characterDef?.behaviorKind === "broker" && brokerMcp && /^\s*accept\s*$/i.test(text)) {
            void Effect.runPromise(
              brokerHandleAccept(e.ghostId, from, characterDef.stakeAmount).pipe(
                Effect.provide(GhostMcpServiceLive(brokerMcp)),
              ),
            ).catch((err: unknown) => {
              console.error(JSON.stringify({
                kind: "npc-agent.broker.accept-error",
                targetGhostId: e.ghostId,
                error: err instanceof Error ? err.message : String(err),
              }));
            });
          } else {
            void handleDialogMessage(e.ghostId, from, text).catch((err: unknown) => {
              console.error(JSON.stringify({
                kind: "npc-agent.dialog.error",
                targetGhostId: e.ghostId,
                error: err instanceof Error ? err.message : String(err),
              }));
            });
          }
        }
        return Promise.resolve();
      }),
      Match.orElse(() => Promise.resolve()),
    );
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

    if (!sp.ghostCard.characterId || !catalog) {
      // Unexpected: npc-agent no longer has an orchestrator ghost.
      // Log and complete so the A2A context doesn't hang.
      log.info({ kind: "spawn-received.unexpected-orchestrator", ghostId: sp.ghostId });
      publishCompleted(taskId, contextId, eventBus);
      return;
    }

    const characterDef = catalog.byId.get(sp.ghostCard.characterId);
    if (!characterDef) {
      log.info({ kind: "character.spawn-unknown", ghostId: sp.ghostId, characterId: sp.ghostCard.characterId });
      publishCompleted(taskId, contextId, eventBus);
      return;
    }

    log.info({ kind: "character.spawn-received", ghostId: sp.ghostId, characterId: sp.ghostCard.characterId });
    sharedState.ghostIdByCharacter = new Map([
      ...sharedState.ghostIdByCharacter,
      [sp.ghostCard.characterId, sp.ghostId],
    ]);
    await launchGhostLoop(sp, characterDef);
    publishCompleted(taskId, contextId, eventBus);
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

  await mcp.say({ intent: DEFAULT_INTENT, content: result.response, to: partnerGhostId });
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

      // Single tick: dispatch to behavior-specific Effect, provide the MCP service, then sleep.
      // Tick failure is non-fatal: logged and skipped (FR-005).
      const tick = Effect.gen(function* () {
        const tickEffect = Match.value(characterDef.behaviorKind).pipe(
          Match.when("broker",      () => brokerTick(ctx.ghostId)),
          Match.when("rule-engine", () => ruleEngineTick(ctx.ghostId, characterDef)),
          Match.exhaustive,
        );
        yield* tickEffect.pipe(
          Effect.provide(GhostMcpServiceLive(mcp)),
          Effect.catchAll((e) =>
            Effect.sync(() =>
              console.warn(
                JSON.stringify({
                  kind: "npc-agent.character.tick-error",
                  ghostId: ctx.ghostId,
                  error: String(e),
                }),
              ),
            ),
          ),
        );
        yield* Effect.sleep(Duration.millis(_tickMs));
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
    log.info({ kind: "character.loop-cancel", ghostId, reason: "spawn-replace" });
    await Effect.runPromise(Fiber.interrupt(existing));
    actionFibersByGhostId.delete(ghostId);
  }

  if (characterDef.behaviorKind === "broker") {
    clearBrokerState(ghostId);
  }

  const fiber = Effect.runFork(ghostActionLoop(ctx, characterDef));
  actionFibersByGhostId.set(ghostId, fiber);

  log.info({
    kind: "character.loop-start",
    ghostId,
    characterId: characterDef.id,
    tickMs: ACTION_TICK_MS,
  });
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

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Not part of the public API. Exposes internals for executor-concurrency.test.ts.
 * All members are prefixed with nothing — callers import this namespace as `_test`.
 */
export const _test = {
  setTickMs: (ms: number): void => {
    _tickMs = ms;
  },
  resetTickMs: (): void => {
    _tickMs = ACTION_TICK_MS;
  },
  activeFiberCount: (): number => actionFibersByGhostId.size,
  getFiber: (ghostId: string): Fiber.RuntimeFiber<void, never> | undefined =>
    actionFibersByGhostId.get(ghostId),
  /**
   * Interrupt every active fiber, then clear all module-level maps.
   * Call in afterEach to guarantee clean state between tests.
   */
  async interruptAll(): Promise<void> {
    const fibers = Array.from(actionFibersByGhostId.values());
    actionFibersByGhostId.clear();
    mcpByGhostId.clear();
    dialogStateMap.clear();
    await Promise.all(fibers.map((f) => Effect.runPromise(Fiber.interrupt(f))));
  },
  launchGhostLoop,
};

