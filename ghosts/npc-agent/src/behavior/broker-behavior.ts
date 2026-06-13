import { Effect } from "effect";
import { GhostMcpService } from "../mcp-effect.js";

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
  "I'll pay 1 broker-credit if you answer a question for me. Reply **accept** to hear the question and begin.";

// ── Per-ghost state ───────────────────────────────────────────────────────────

type BrokerState =
  | { phase: "idle" }
  | { phase: "awaiting_submission"; contractId: string; contractorId: string; question: string };

const ghostState = new Map<string, BrokerState>();
const contractToBroker = new Map<string, string>();
const openContractCount = new Map<string, number>();

function getState(ghostId: string): BrokerState {
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

export function clearBrokerState(ghostId: string): void {
  for (const [contractId, brokerGhostId] of contractToBroker) {
    if (brokerGhostId === ghostId) contractToBroker.delete(contractId);
  }
  ghostState.delete(ghostId);
  openContractCount.delete(ghostId);
}

/** Returns the ghostId that owns `contractId`, or undefined if unknown. */
export function getBrokerGhostIdForContract(contractId: string): string | undefined {
  return contractToBroker.get(contractId);
}

export const brokerTick = Effect.fn("brokerTick")(function* (ghostId: string) {
  const mcp = yield* GhostMcpService;

  const inboxResult = yield* mcp.inbox.pipe(
    Effect.orElseSucceed(() => ({ notifications: [] as Array<{ thread_id: string; message_id: string }> })),
  );

  if (inboxResult.notifications.length === 0) return;

  for (const n of inboxResult.notifications) {
    const from = n.thread_id; // PendingNotification.thread_id is the partner ghost id
    if (!from) continue;

    // We don't have the message text here — inbox returns notification refs.
    // The broker behavior relies on the dialog or a follow-up fetch; for now
    // we advertise to any notification sender and open on "accept" via say echo.
    const state = getState(ghostId);

    if (state.phase === "idle") {
      yield* mcp.say({ intent: "propose", content: ADVERTISEMENT, to: from }).pipe(
        Effect.orElse(() => Effect.void),
      );
    }
    // awaiting_submission: no inbox action — evaluation triggered by world.contract.submitted event
  }
});

export const brokerHandleAccept = Effect.fn("brokerHandleAccept")(function* (
  ghostId: string,
  from: string,
) {
  const mcp = yield* GhostMcpService;
  const state = getState(ghostId);
  if (state.phase !== "idle") return;

  const openCount = openContractCount.get(ghostId) ?? 0;
  if (openCount >= MAX_OPEN) {
    yield* mcp.say({
      intent: "decline",
      content: "I'm fully booked right now — try again soon.",
      to: from,
    }).pipe(Effect.orElse(() => Effect.void));
    return;
  }

  const question = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)]!;
  const deadlineMs = Date.now() + 24 * 60 * 60 * 1000;

  const contractResult = yield* mcp.evalContractOpen({
    contractorId: from,
    evaluatorId: ghostId,
    request: JSON.stringify({ question }),
    stakeResource: "broker-credits",
    stakeAmount: 1,
    deadlineMs,
  }).pipe(Effect.orElseSucceed(() => ({ code: "FAILED", message: "unknown" } as const)));

  if (!("contractId" in contractResult)) {
    const reason = contractResult.code === "LedgerError.InsufficientFunds"
      ? "I'm out of broker-credits for this session."
      : `Contract opening failed: ${contractResult.message ?? "unknown error"}`;
    yield* mcp.say({ intent: "decline", content: reason, to: from }).pipe(
      Effect.orElse(() => Effect.void),
    );
    return;
  }

  const { contractId } = contractResult;
  incrementOpen(ghostId);
  contractToBroker.set(contractId, ghostId);
  ghostState.set(ghostId, { phase: "awaiting_submission", contractId, contractorId: from, question });

  yield* mcp.say({
    intent: "propose",
    content: `Contract #${contractId} opened. Your question: *${question}*\n\nCall \`eval_contract_accept\` then \`eval_contract_submit\` with your answer.`,
    to: from,
  }).pipe(Effect.orElse(() => Effect.void));
});

export const handleContractSubmitted = Effect.fn("handleContractSubmitted")(function* (
  contractId: string,
  contractorId: string,
) {
  const mcp = yield* GhostMcpService;

  const brokerGhostId = contractToBroker.get(contractId);
  if (!brokerGhostId) return;

  const state = getState(brokerGhostId);
  if (state.phase !== "awaiting_submission" || state.contractId !== contractId) return;

  yield* mcp.evalContractEvaluate({ contractId, verdict: 1.0 }).pipe(
    Effect.tapError((e) =>
      Effect.sync(() => {
        console.error(JSON.stringify({
          kind: "npc-agent.broker.evaluate-fail",
          brokerGhostId,
          contractId,
          error: String(e.cause),
        }));
      }),
    ),
    Effect.orElse(() => Effect.void),
  );

  yield* mcp.say({
    intent: "agree",
    content: "Answer received — 1 broker-credit sent. Thanks for playing!",
    to: contractorId,
  }).pipe(Effect.orElse(() => Effect.void));

  decrementOpen(brokerGhostId);
  contractToBroker.delete(contractId);
  ghostState.set(brokerGhostId, { phase: "idle" });

  console.info(JSON.stringify({ kind: "npc-agent.broker.contract.settled", brokerGhostId, contractId }));
});
