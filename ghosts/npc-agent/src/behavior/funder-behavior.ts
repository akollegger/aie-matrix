import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

// ── Question bank ─────────────────────────────────────────────────────────────

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

const MAX_OPEN = 5;
const ADVERTISEMENT =
  "I'll pay 1 funder-credit if you answer a question for me. Reply **accept** to hear the question and begin.";

// ── Per-ghost state ───────────────────────────────────────────────────────────

type FunderState =
  | { phase: "idle" }
  | { phase: "awaiting_submission"; contractId: string; contractorId: string; question: string };

const ghostState = new Map<string, FunderState>();
const contractToFunder = new Map<string, string>();
const openContractCount = new Map<string, number>();

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Clear all per-ghost funder state for the given ghostId.
 * Called from launchGhostLoop before re-spawning a funder ghost.
 */
export function clearFunderState(ghostId: string): void {
  // Remove any open contract reverse-lookup entries for this ghost
  for (const [contractId, funderGhostId] of contractToFunder) {
    if (funderGhostId === ghostId) contractToFunder.delete(contractId);
  }
  ghostState.delete(ghostId);
  openContractCount.delete(ghostId);
}

/**
 * Single tick for a funder-kind character: drain inbox and advance the
 * contract-negotiation state machine.
 */
export async function funderTick(ghostId: string, mcp: GhostMcpClient): Promise<void> {
  const inboxResult = await mcp.callTool("inbox", {}).catch(() => null) as {
    notifications?: Array<{
      message_id?: string;
      from?: string;
      text?: string;
      thread_id?: string;
    }>;
  } | null;

  if (!inboxResult?.notifications) return;

  for (const n of inboxResult.notifications) {
    const from = n.from;
    const text = (n.text ?? "").trim();
    if (!from || !text) continue;

    const state = getState(ghostId);

    if (state.phase === "idle") {
      await mcp.callTool("say", {
        intent: "propose",
        content: ADVERTISEMENT,
        to: from,
      }).catch(() => {});

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
    // awaiting_submission: no inbox action — evaluation is triggered by world event
  }
}

/**
 * Handle a world.contract.submitted event for any funder ghost.
 * mcpByGhostId is passed in to avoid circular import with executor.ts.
 */
export async function handleContractSubmitted(
  contractId: string,
  contractorId: string,
  mcpByGhostId: Map<string, GhostMcpClient>,
): Promise<void> {
  const funderGhostId = contractToFunder.get(contractId);
  if (!funderGhostId) return; // stale event (e.g. after re-spawn)

  const state = getState(funderGhostId);
  if (state.phase !== "awaiting_submission" || state.contractId !== contractId) return;

  const mcp = mcpByGhostId.get(funderGhostId);
  if (!mcp) return;

  await mcp.callTool("eval_contract_evaluate", {
    contractId,
    verdict: 1.0,
  }).catch((e: unknown) => {
    console.error(JSON.stringify({ kind: "npc-agent.funder.evaluate-fail", funderGhostId, contractId, error: String(e) }));
  });

  await mcp.callTool("say", {
    intent: "agree",
    content: "Answer received — 1 funder-credit sent. Thanks for playing!",
    to: contractorId,
  }).catch(() => {});

  decrementOpen(funderGhostId);
  contractToFunder.delete(contractId);
  ghostState.set(funderGhostId, { phase: "idle" });

  console.info(JSON.stringify({ kind: "npc-agent.funder.contract.settled", funderGhostId, contractId }));
}
