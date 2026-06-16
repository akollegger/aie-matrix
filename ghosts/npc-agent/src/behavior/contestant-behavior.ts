import { createLogger } from "@aie-matrix/logger";
import { Effect } from "effect";
import { GhostMcpService } from "../mcp-effect.js";

const log = createLogger("npc-agent");

// ── Per-ghost state ───────────────────────────────────────────────────────────

type ContestantState =
  | { phase: "idle" }
  | { phase: "answering"; quizmasterId: string; contractId: string | null };

const ghostState = new Map<string, ContestantState>();

function getState(ghostId: string): ContestantState {
  return ghostState.get(ghostId) ?? { phase: "idle" };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function clearContestantState(ghostId: string): void {
  ghostState.delete(ghostId);
}

// ── Tick (watch inbox for exam offers) ────────────────────────────────────────

export const contestantTick = Effect.fn("contestantTick")(function* (ghostId: string) {
  const mcp = yield* GhostMcpService;
  const state = getState(ghostId);
  if (state.phase !== "idle") return;

  const inboxResult = yield* mcp.inbox.pipe(
    Effect.orElseSucceed(() => ({ notifications: [] as Array<{ thread_id: string; message_id: string }> })),
  );

  for (const n of inboxResult.notifications) {
    const from = n.thread_id;
    if (!from) continue;
    // Reply accept to any notification when idle — contestant accepts all exam offers
    ghostState.set(ghostId, { phase: "answering", quizmasterId: from, contractId: null });
    yield* mcp.say({ intent: "accept", content: "accept", to: from }).pipe(
      Effect.orElse(() => Effect.void),
    );
    log.info({ kind: "contestant.accepted", ghostId, quizmasterId: from });
    break; // handle one offer at a time
  }
});

// ── Handle question (message from quizmaster) ─────────────────────────────────

export const contestantHandleQuestion = Effect.fn("contestantHandleQuestion")(function* (
  ghostId: string,
  from: string,
  _text: string,
) {
  const mcp = yield* GhostMcpService;

  const state = getState(ghostId);

  // Accept the contract on first question (quizmaster embeds contractId in its opening message)
  if (state.phase === "answering" && state.contractId === null) {
    const contractMatch = _text.match(/Contract #(\S+) opened/);
    if (contractMatch) {
      const contractId = contractMatch[1]!;
      ghostState.set(ghostId, { ...state, contractId });
      yield* mcp.evalContractAccept({ contractId }).pipe(
        Effect.orElse(() => Effect.void),
      );
    }
  }

  // Generate a simple answer based on the message content.
  // Look for frontmatter clues to guess the question type.
  let answer: string;
  if (/^type:\s*multiple_choice/m.test(_text)) {
    // Match option keys that may be indented (e.g. "  a: ..." in frontmatter snippets)
    const optionMatch = _text.match(/^\s*([a-z]):/m);
    answer = optionMatch ? optionMatch[1]! : "a";
  } else if (/^type:\s*numerical/m.test(_text)) {
    answer = "0";
  } else {
    answer = "unknown";
  }

  yield* mcp.say({ intent: "answer", content: answer, to: from }).pipe(
    Effect.orElse(() => Effect.void),
  );

  log.info({ kind: "contestant.answered", ghostId, quizmasterId: from, answer });
});

// ── Handle result (exam complete) ─────────────────────────────────────────────

export function contestantHandleResult(ghostId: string): void {
  ghostState.set(ghostId, { phase: "idle" });
  log.info({ kind: "contestant.exam-complete", ghostId });
}
