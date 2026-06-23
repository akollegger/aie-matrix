import { createLogger } from "@aie-matrix/logger";
import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import { AgentExecutor, type ExecutionEventBus, type RequestContext } from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import { Effect, Fiber, Duration, Match, Schedule } from "effect";
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  makeReconnectSchedule,
  McpConnectionBroken,
  logDegraded,
  logRecovered,
} from "./reconnect.js";
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
import {
  loadExam,
  setExam,
  clearQuizmasterState,
  quizmasterTick,
  quizmasterHandleAccept,
  quizmasterHandleAnswer,
} from "./behavior/quizmaster-behavior.js";
import {
  clearContestantState,
  contestantTick,
  contestantHandleQuestion,
  contestantHandleResult,
} from "./behavior/contestant-behavior.js";

const log = createLogger("npc-agent");

const ACTION_TICK_MS = 3000;

// Placeholder until issue #49 resolves the say.intent model.
// https://github.com/akollegger/aie-matrix/issues/49
const DEFAULT_INTENT = "greet";
/** Mutable tick interval — overridden by tests via _test.setTickMs(). Production value is ACTION_TICK_MS. */
let _tickMs = ACTION_TICK_MS;

/** Per-character ghost fiber handles. Keyed by ghostId. */
const actionFibersByGhostId = new Map<string, Fiber.RuntimeFiber<void, never>>();

/** Degraded state per ghostId — set when MCP reconnect backoff begins, cleared on recover. */
const degradedByGhostId = new Set<string>();

/** Ghosts whose action loops exhausted all retries and failed permanently. */
const permanentlyFailedGhosts = new Set<string>();

/** A2A task ownership: ghostId → taskId (the task keeping the ghost "working"). */
const ghostIdToTaskId = new Map<string, string>();
/** Reverse index: taskId → ghostId, for cancelTask lookups. */
const taskIdToGhostId = new Map<string, string>();

/** Returns the set of ghostIds currently in degraded (reconnecting) state. */
export function getDegradedGhosts(): ReadonlySet<string> {
  return degradedByGhostId;
}

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
let catalogDir = "";

export function initExecutor(opts: {
  catalog: NpcAgentCatalog;
  catalogDir: string;
  agentHostUrl: string;
  agentId: string;
}): void {
  catalog = opts.catalog;
  catalogDir = opts.catalogDir;
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
    const ghostId = taskIdToGhostId.get(taskId);
    taskIdToGhostId.delete(taskId);
    if (ghostId && ghostIdToTaskId.get(ghostId) === taskId) {
      ghostIdToTaskId.delete(ghostId);
      const fiber = actionFibersByGhostId.get(ghostId);
      if (fiber) {
        await Effect.runPromise(Fiber.interrupt(fiber));
      }
    }
    // handleSpawnContext is awaiting the fiber; it will see stillOwned=false
    // and skip publishing. Publish "canceled" here so the A2A task closes cleanly.
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
        const characterDef = characterForGhostId(e.ghostId);
        const examBehavior = characterDef?.behaviorKind === "quizmaster" || characterDef?.behaviorKind === "contestant";
        // FR-009: ignore sibling-NPC senders, EXCEPT for quizmaster/contestant pair
        const fromNpc = isNpcCharacterGhost(from);
        if (
          (priority === "PARTNER" || priority === "DIRECT") &&
          isNpcCharacterGhost(e.ghostId) &&
          (!fromNpc || examBehavior)
        ) {
          const mcp = mcpByGhostId.get(e.ghostId);
          if (characterDef?.behaviorKind === "broker" && mcp && /^\s*accept\s*$/i.test(text)) {
            void Effect.runPromise(
              brokerHandleAccept(e.ghostId, from, characterDef.stakeAmount).pipe(
                Effect.provide(GhostMcpServiceLive(mcp)),
              ),
            ).catch((err: unknown) => {
              console.error(JSON.stringify({
                kind: "npc-agent.broker.accept-error",
                targetGhostId: e.ghostId,
                error: err instanceof Error ? err.message : String(err),
              }));
            });
          } else if (characterDef?.behaviorKind === "quizmaster" && mcp) {
            if (/^\s*accept\s*$/i.test(text)) {
              void Effect.runPromise(
                quizmasterHandleAccept(e.ghostId, from, characterDef.stakeAmount).pipe(
                  Effect.provide(GhostMcpServiceLive(mcp)),
                ),
              ).catch((err: unknown) => {
                console.error(JSON.stringify({
                  kind: "npc-agent.quizmaster.accept-error",
                  targetGhostId: e.ghostId,
                  error: err instanceof Error ? err.message : String(err),
                }));
              });
            } else {
              void Effect.runPromise(
                quizmasterHandleAnswer(e.ghostId, from, text).pipe(
                  Effect.provide(GhostMcpServiceLive(mcp)),
                ),
              ).catch((err: unknown) => {
                console.error(JSON.stringify({
                  kind: "npc-agent.quizmaster.answer-error",
                  targetGhostId: e.ghostId,
                  error: err instanceof Error ? err.message : String(err),
                }));
              });
            }
          } else if (characterDef?.behaviorKind === "contestant" && mcp) {
            if (/^Exam complete!/i.test(text)) {
              contestantHandleResult(e.ghostId);
            } else {
              void Effect.runPromise(
                contestantHandleQuestion(e.ghostId, from, text).pipe(
                  Effect.provide(GhostMcpServiceLive(mcp)),
                ),
              ).catch((err: unknown) => {
                console.error(JSON.stringify({
                  kind: "npc-agent.contestant.question-error",
                  targetGhostId: e.ghostId,
                  error: err instanceof Error ? err.message : String(err),
                }));
              });
            }
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

    // Register task ownership BEFORE the first await so cancelTask() can reach the fiber.
    const prevTaskId = ghostIdToTaskId.get(sp.ghostId);
    if (prevTaskId) taskIdToGhostId.delete(prevTaskId);
    ghostIdToTaskId.set(sp.ghostId, taskId);
    taskIdToGhostId.set(taskId, sp.ghostId);

    // Await the loop — keeps this A2A task "working" until the ghost exits.
    // The loop exits when: (a) cancelTask interrupts the fiber, or
    // (b) the fiber fails permanently after all MCP retries exhaust.
    const fiber = await launchGhostLoop(sp, characterDef);
    await Effect.runPromise(Fiber.await(fiber));
    if (actionFibersByGhostId.get(sp.ghostId) === fiber) {
      actionFibersByGhostId.delete(sp.ghostId);
    }

    const stillOwned = ghostIdToTaskId.get(sp.ghostId) === taskId;
    if (stillOwned) {
      ghostIdToTaskId.delete(sp.ghostId);
      taskIdToGhostId.delete(taskId);
      const terminalState = permanentlyFailedGhosts.has(sp.ghostId) ? "failed" : "completed";
      permanentlyFailedGhosts.delete(sp.ghostId);
      publishTerminal(terminalState, taskId, contextId, eventBus);
    }
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
 * One attempt of the ghost action loop (spec-035 T015).
 * Connects an MCP client, runs ticks until CONSECUTIVE_FAILURE_THRESHOLD
 * is reached, then disconnects and fails with McpConnectionBroken so the
 * outer retry can re-acquire a fresh connection.
 */
function ghostActionLoopOnce(
  ctx: SpawnContext,
  characterDef: CharacterDefinition,
  wasRecoveringRef: { value: boolean },
): Effect.Effect<void, McpConnectionBroken> {
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
            const glyph = characterDef.glyph || ctx.ghostCard?.glyph || "";
            await client.announce(characterDef.gramLabels, glyph).catch(() => {});
            mcpByGhostId.set(ctx.ghostId, client);
            return client;
          },
          catch: (e) => new McpConnectionBroken({
            ghostId: ctx.ghostId,
            reason: e instanceof Error ? e.message : String(e),
          }),
        }),
        // Release: despawn then disconnect unconditionally on fiber exit or interruption.
        (client) =>
          Effect.promise(() =>
            client
              .callTool("ghost_despawn", {})
              .catch(() => {})
              .then(() => client.disconnect().catch(() => {}))
              .then(() => {
                mcpByGhostId.delete(ctx.ghostId);
              }),
          ),
      );

      let consecutiveFailures = 0;

      const tick = Effect.gen(function* () {
        const tickEffect = Match.value(characterDef.behaviorKind).pipe(
          Match.when("broker",      () => brokerTick(ctx.ghostId)),
          Match.when("rule-engine", () => ruleEngineTick(ctx.ghostId, characterDef)),
          Match.when("quizmaster",  () => quizmasterTick(ctx.ghostId)),
          Match.when("contestant",  () => contestantTick(ctx.ghostId)),
          Match.exhaustive,
        );
        const tickResult = yield* tickEffect.pipe(
          Effect.provide(GhostMcpServiceLive(mcp)),
          Effect.map(() => "ok" as const),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              consecutiveFailures++;
              console.warn(
                JSON.stringify({
                  kind: "npc-agent.character.tick-error",
                  ghostId: ctx.ghostId,
                  consecutiveFailures,
                  error: String(e),
                }),
              );
              return "err" as const;
            }),
          ),
        );

        if (tickResult === "ok") {
          consecutiveFailures = 0;
          // Emit recovered on first successful tick after a degraded period.
          if (wasRecoveringRef.value) {
            wasRecoveringRef.value = false;
            degradedByGhostId.delete(ctx.ghostId);
            logRecovered(ctx.ghostId);
          }
        } else if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
          yield* Effect.fail(
            new McpConnectionBroken({
              ghostId: ctx.ghostId,
              reason: `${consecutiveFailures} consecutive tick failures`,
            }),
          );
        }

        yield* Effect.sleep(Duration.millis(_tickMs));
      });

      yield* Effect.forever(tick);
    }),
  );
}

/**
 * Full ghost action loop with MCP reconnect (spec-035 T016).
 * Wraps `ghostActionLoopOnce` with exponential-backoff retry.
 * Emits `npc-agent.mcp.degraded` once when threshold is hit and
 * `npc-agent.mcp.recovered` once on the first successful tick after reconnect.
 * On retry schedule exhaustion, emits `npc-agent.mcp.failed-permanently`.
 */
function ghostActionLoop(
  ctx: SpawnContext,
  characterDef: CharacterDefinition,
): Effect.Effect<void, never> {
  const wasRecoveringRef = { value: false };

  return ghostActionLoopOnce(ctx, characterDef, wasRecoveringRef).pipe(
    Effect.retry(
      Schedule.intersect(
        makeReconnectSchedule(),
        Schedule.recurWhile((_err: McpConnectionBroken) => {
          if (!wasRecoveringRef.value) {
            wasRecoveringRef.value = true;
            degradedByGhostId.add(ctx.ghostId);
            logDegraded(ctx.ghostId);
          }
          return true;
        }),
      ) as unknown as Schedule.Schedule<unknown, McpConnectionBroken, never>,
    ),
    Effect.catchAll((e) =>
      Effect.sync(() => {
        permanentlyFailedGhosts.add(ctx.ghostId);
        console.error(
          JSON.stringify({
            event: "npc-agent.mcp.failed-permanently",
            ghostId: ctx.ghostId,
            error: e instanceof McpConnectionBroken ? e.reason : String(e),
          }),
        );
      }),
    ),
  );
}

/**
 * Fork a ghost action loop fiber. If a loop is already running for the given
 * ghostId, it is interrupted before the new fiber starts. Returns the new fiber
 * so the caller can await completion (handleSpawnContext does this to keep the
 * A2A task in "working" state until the ghost exits).
 */
async function launchGhostLoop(
  ctx: SpawnContext,
  characterDef: CharacterDefinition,
): Promise<Fiber.RuntimeFiber<void, never>> {
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
  if (characterDef.behaviorKind === "contestant") {
    clearContestantState(ghostId);
  }

  if (characterDef.behaviorKind === "quizmaster" && characterDef.examPath) {
    clearQuizmasterState(ghostId);
    loadExam(characterDef.examPath, catalogDir).then((exam) => {
      setExam(ghostId, exam);
    }).catch((e) => {
      log.error({
        kind: "quizmaster.exam-load-failed",
        ghostId,
        examPath: characterDef.examPath,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  const fiber = Effect.runFork(ghostActionLoop(ctx, characterDef));
  actionFibersByGhostId.set(ghostId, fiber);

  log.info({
    kind: "character.loop-start",
    ghostId,
    characterId: characterDef.id,
    tickMs: ACTION_TICK_MS,
  });

  return fiber;
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
  publishTerminal("completed", taskId, contextId, eventBus);
}

function publishTerminal(
  state: "completed" | "failed" | "canceled",
  taskId: string,
  contextId: string | undefined,
  eventBus: ExecutionEventBus,
): void {
  eventBus.publish({
    kind: "status-update",
    taskId,
    contextId: contextId ?? taskId,
    final: true,
    status: { state, timestamp: new Date().toISOString() },
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
    ghostIdToTaskId.clear();
    taskIdToGhostId.clear();
    permanentlyFailedGhosts.clear();
    await Promise.all(fibers.map((f) => Effect.runPromise(Fiber.interrupt(f))));
  },
  launchGhostLoop,
};

