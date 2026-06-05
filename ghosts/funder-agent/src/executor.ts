import type { Message, Task, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { randomUUID } from "node:crypto";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { SpawnContext } from "./spawn-types.js";
import type { WorldEvent } from "./world-event.js";

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

const QUESTIONS = [
  "What's one thing you wish AI systems were better at?",
  "If you could add one feature to this world, what would it be?",
  "What's the most surprising thing about being a ghost in a digital world?",
  "Describe your ideal collaboration between a human and an AI.",
  "What question would you ask an AI that no one has thought to ask yet?",
  "What's worth preserving as AI gets more capable?",
  "If this world had a newspaper, what would today's headline be?",
  "What's the difference between being helpful and being useful?",
  "What would you do with more time?",
  "What does it mean to know something?",
];

// ---------------------------------------------------------------------------
// Per-ghost state
// ---------------------------------------------------------------------------

type FunderState =
  | { phase: "idle" }
  | { phase: "awaiting_submission"; contractId: string; contractorId: string; question: string };

const ghostState = new Map<string, FunderState>();
/** contractId → ghostId (funder) for reverse-lookup on submitted events */
const contractToFunder = new Map<string, string>();
/** ghostId (funder) → count of open contracts */
const openContractCount = new Map<string, number>();

const MAX_OPEN = 5;
const ADVERTISEMENT =
  "I'll pay 1 funder-credit if you answer a question for me. Reply **accept** to hear the question and begin.";

function getState(ghostId: string): FunderState {
  return ghostState.get(ghostId) ?? { phase: "idle" };
}

function incrementOpen(ghostId: string): void {
  openContractCount.set(ghostId, (openContractCount.get(ghostId) ?? 0) + 1);
}

function decrementOpen(ghostId: string): void {
  const c = openContractCount.get(ghostId) ?? 0;
  openContractCount.set(ghostId, Math.max(0, c - 1));
}

// ---------------------------------------------------------------------------
// Spawn tracking
// ---------------------------------------------------------------------------

const loopsByGhostId = new Map<string, { cancel: () => void }>();
const mcpByGhostId = new Map<string, GhostMcpClient>();
const ghostIdToTaskId = new Map<string, string>();

type SpawnTaskMeta = { readonly ghostId: string; readonly contextId: string };
const spawnTaskMeta = new Map<string, SpawnTaskMeta>();

function registerSpawnTask(taskId: string, ghostId: string, contextId: string): void {
  const prev = ghostIdToTaskId.get(ghostId);
  if (prev !== undefined && prev !== taskId) {
    spawnTaskMeta.delete(prev);
  }
  ghostIdToTaskId.set(ghostId, taskId);
  spawnTaskMeta.set(taskId, { ghostId, contextId });
}

function cancelLoopForGhost(ghostId: string): void {
  loopsByGhostId.get(ghostId)?.cancel();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function startFunderLoop(ctx: SpawnContext): Promise<void> {
  const { ghostId } = ctx;
  cancelLoopForGhost(ghostId);

  const mcp = new GhostMcpClient({
    worldApiBaseUrl: ctx.houseEndpoints.mcp,
    token: ctx.token,
  });
  await mcp.connect();
  mcpByGhostId.set(ghostId, mcp);

  let go = true;
  let wakeUp: (() => void) | null = null;
  const handle = { cancel: () => { go = false; wakeUp?.(); } };
  loopsByGhostId.set(ghostId, handle);

  console.info(JSON.stringify({ kind: "funder-agent.loop.start", ghostId }));

  try {
    while (go) {
      // Drain inbox and handle messages
      const inboxResult = await mcp.callTool("inbox", {}).catch(() => null) as {
        notifications?: Array<{
          message_id?: string;
          from?: string;
          text?: string;
          thread_id?: string;
        }>;
      } | null;

      if (inboxResult?.notifications) {
        for (const n of inboxResult.notifications) {
          const from = n.from;
          const text = (n.text ?? "").trim();
          if (!from || !text) continue;

          const state = getState(ghostId);

          if (state.phase === "idle") {
            // Always reply with advertisement on any message
            await mcp.callTool("say", {
              intent: "propose",
              content: ADVERTISEMENT,
              to: from,
            }).catch(() => {});

            // If they said "accept" (exact word match, not "I don't accept"), open a contract
            if (/^\s*accept\s*$/i.test(text)) {
              const openCount = openContractCount.get(ghostId) ?? 0;
              if (openCount >= MAX_OPEN) {
                await mcp.callTool("say", {
                  intent: "decline",
                  content: "I'm fully booked right now — try again soon.",
                  to: from,
                }).catch(() => {});
                continue;
              }

              const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]!;
              const deadlineMs = Date.now() + 24 * 60 * 60 * 1000;

              const contractResult = await mcp.callTool("eval_contract_open", {
                contractorId: from,
                evaluatorId: ghostId,
                request: JSON.stringify({ question }),
                stakeResource: "funder-credits",
                stakeAmount: 1,
                deadlineMs,
              }).catch(() => null) as { contractId?: string; ok?: boolean; code?: string; message?: string } | null;

              if (!contractResult?.contractId) {
                const reason = contractResult?.code === "LedgerError.InsufficientFunds"
                  ? "I'm out of funder-credits for this session."
                  : `Contract opening failed: ${contractResult?.message ?? "unknown error"}`;
                await mcp.callTool("say", {
                  intent: "decline",
                  content: reason,
                  to: from,
                }).catch(() => {});
                continue;
              }

              const contractId = contractResult.contractId;
              incrementOpen(ghostId);
              contractToFunder.set(contractId, ghostId);
              ghostState.set(ghostId, { phase: "awaiting_submission", contractId, contractorId: from, question });

              await mcp.callTool("say", {
                intent: "propose",
                content: `Contract #${contractId} opened. Your question: *${question}*\n\nCall \`eval_contract_accept\` then \`eval_contract_submit\` with your answer.`,
                to: from,
              }).catch(() => {});
            }
          }
        }
      }

      // Wait before next poll
      await new Promise<void>((r) => {
        const t = setTimeout(r, 3000);
        wakeUp = () => { clearTimeout(t); r(); };
      });
    }
  } finally {
    if (loopsByGhostId.get(ghostId) === handle) {
      loopsByGhostId.delete(ghostId);
    }
    if (mcpByGhostId.get(ghostId) === mcp) {
      mcpByGhostId.delete(ghostId);
    }
    await mcp.disconnect().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Handle world.contract.submitted event
// ---------------------------------------------------------------------------

async function handleContractSubmitted(
  ghostId: string,
  contractId: string,
  contractorId: string,
): Promise<void> {
  const state = getState(ghostId);
  if (state.phase !== "awaiting_submission" || state.contractId !== contractId) {
    return;
  }

  const mcp = mcpByGhostId.get(ghostId);
  if (!mcp) return;

  // Evaluate at full score
  await mcp.callTool("eval_contract_evaluate", {
    contractId,
    verdict: 1.0,
  }).catch((e: unknown) => {
    console.error(JSON.stringify({ kind: "funder-agent.evaluate-fail", ghostId, contractId, error: String(e) }));
  });

  // Notify contractor
  await mcp.callTool("say", {
    intent: "agree",
    content: "Answer received — 1 funder-credit sent. Thanks for playing!",
    to: contractorId,
  }).catch(() => {});

  decrementOpen(ghostId);
  contractToFunder.delete(contractId);
  ghostState.set(ghostId, { phase: "idle" });
  console.info(JSON.stringify({ kind: "funder-agent.contract.settled", ghostId, contractId }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function asWorldEvent(msg: Message | undefined): WorldEvent | null {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "data" && "data" in p) {
      const d = p.data as Record<string, unknown>;
      if (d.schema === "aie-matrix.world-event.v1") {
        return d as unknown as WorldEvent;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class FunderExecutor implements AgentExecutor {
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, contextId, taskId, task } = requestContext;
    const tid = taskId ?? randomUUID();

    // --- Spawn context ---
    const sp = parseSpawnData(userMessage);
    if (sp) {
      const t = task ?? ({
        kind: "task",
        id: tid,
        contextId,
        status: { state: "submitted" as const, timestamp: new Date().toISOString() },
        history: userMessage ? [userMessage] : [],
        artifacts: [],
      } as Task);
      if (!requestContext.task) eventBus.publish(t);

      const w: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: t.id,
        contextId: contextId ?? t.contextId,
        final: false,
        status: { state: "working", timestamp: new Date().toISOString() },
      };
      eventBus.publish(w);
      registerSpawnTask(t.id, sp.ghostId, contextId ?? t.contextId);

      await startFunderLoop(sp).catch((e: unknown) =>
        console.error(`[funder-agent] loop error ghostId=${sp.ghostId}`, e)
      );

      const stillOwned = spawnTaskMeta.get(t.id)?.ghostId === sp.ghostId;
      if (stillOwned) {
        spawnTaskMeta.delete(t.id);
        if (ghostIdToTaskId.get(sp.ghostId) === t.id) {
          ghostIdToTaskId.delete(sp.ghostId);
        }
        const done: TaskStatusUpdateEvent = {
          kind: "status-update",
          taskId: t.id,
          contextId: contextId ?? t.contextId,
          final: true,
          status: { state: "completed", timestamp: new Date().toISOString() },
        };
        eventBus.publish(done);
      }
      eventBus.finished();
      return;
    }

    // --- World events (delivered as independent A2A messages) ---
    const ev = asWorldEvent(userMessage);
    if (ev !== null) {
      if (ev.kind === "world.contract.submitted") {
        const pl = ev.payload as { contractId?: string; contractorId?: string };
        const contractId = typeof pl.contractId === "string" ? pl.contractId : undefined;
        const contractorId = typeof pl.contractorId === "string" ? pl.contractorId : undefined;
        if (contractId && contractorId) {
          // Find which funder ghost owns this contract
          const funderGhostId = contractToFunder.get(contractId) ?? ev.ghostId;
          void handleContractSubmitted(funderGhostId, contractId, contractorId).catch(() => {});
        }
      }

      // Persist delivery task before publishing status-update
      if (!task) {
        const deliveryTask: Task = {
          kind: "task",
          id: tid,
          contextId: contextId ?? tid,
          status: { state: "submitted", timestamp: new Date().toISOString() },
          history: userMessage ? [userMessage] : [],
          artifacts: [],
        };
        eventBus.publish(deliveryTask);
      }
      const done: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: tid,
        contextId: contextId ?? tid,
        final: true,
        status: { state: "completed", timestamp: new Date().toISOString() },
      };
      eventBus.publish(done);
      eventBus.finished();
      return;
    }

    // --- Health check ---
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

  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    const meta = spawnTaskMeta.get(taskId);
    const ghostId = meta?.ghostId;
    if (ghostId) cancelLoopForGhost(ghostId);
    spawnTaskMeta.delete(taskId);
    if (ghostId && ghostIdToTaskId.get(ghostId) === taskId) {
      ghostIdToTaskId.delete(ghostId);
    }
    const ctxId = meta?.contextId ?? "";
    const canceled: TaskStatusUpdateEvent = {
      kind: "status-update",
      taskId,
      contextId: ctxId,
      final: true,
      status: { state: "canceled", timestamp: new Date().toISOString() },
    };
    eventBus.publish(canceled);
  };
}

function userText(msg: Message | undefined): string {
  for (const p of msg?.parts ?? []) {
    if (p.kind === "text" && "text" in p) return p.text;
  }
  return "";
}
