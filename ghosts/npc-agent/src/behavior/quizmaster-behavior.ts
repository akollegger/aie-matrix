import { resolve } from "node:path";
import { createLogger } from "@aie-matrix/logger";
import { Effect } from "effect";
import { parseExamGramFile, type QuestionSnippet } from "../exam/parse-exam-gram.js";
import { toPromptOnly, toFull, toSubmission } from "../exam/snippet-compiler.js";
import { hashSnippets } from "../exam/hash-artifact.js";
import { GhostMcpService } from "../mcp-effect.js";

const log = createLogger("npc-agent");

// ── ExamDefinition ────────────────────────────────────────────────────────────

export interface ExamDefinition {
  readonly questions: QuestionSnippet[];
  readonly promptSnippets: string[];
  readonly fullSnippets: string[];
  readonly artifactRef: string;
  readonly disclosureRef: string;
}

// ── Per-ghost state ───────────────────────────────────────────────────────────

type QuizmasterState =
  | { phase: "idle" }
  | {
      phase: "conducting";
      contractId: string;
      contestantId: string;
      questionIndex: number;
      answers: string[];
    };

const ghostState = new Map<string, QuizmasterState>();
const examByGhostId = new Map<string, ExamDefinition>();

function getState(ghostId: string): QuizmasterState {
  return ghostState.get(ghostId) ?? { phase: "idle" };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function clearQuizmasterState(ghostId: string): void {
  ghostState.delete(ghostId);
}

export function setExam(ghostId: string, exam: ExamDefinition): void {
  examByGhostId.set(ghostId, exam);
}

// ── loadExam (startup) ────────────────────────────────────────────────────────

export async function loadExam(examPath: string, catalogDir: string): Promise<ExamDefinition> {
  const absolutePath = resolve(catalogDir, examPath);
  const questions = await Effect.runPromise(parseExamGramFile(absolutePath));
  const promptSnippets = questions.map(toPromptOnly);
  const fullSnippets = questions.map(toFull);
  const artifactRef = hashSnippets(promptSnippets);
  const disclosureRef = hashSnippets(fullSnippets);

  log.info({
    kind: "quizmaster.exam-loaded",
    examPath,
    questionCount: questions.length,
    artifactRef,
    disclosureRef,
  });

  return { questions, promptSnippets, fullSnippets, artifactRef, disclosureRef };
}

// ── Verdict computation ───────────────────────────────────────────────────────

export function scoreAnswer(q: QuestionSnippet, answer: string): number {
  if (q.type === "numerical") {
    const parsed = parseFloat(answer.trim());
    if (isNaN(parsed)) return 0;
    const correct = typeof q.correct === "number" ? q.correct : parseFloat(String(q.correct));
    const tolerance = q.tolerance ?? 0;
    return Math.abs(parsed - correct) <= tolerance ? 1.0 : 0.0;
  }
  // multiple_choice or short_answer: case-insensitive exact match
  const correctStr = String(q.correct).trim().toLowerCase();
  const answerStr = answer.trim().toLowerCase();
  return correctStr === answerStr ? 1.0 : 0.0;
}

function computeVerdict(questions: QuestionSnippet[], answers: string[]): number {
  let weightedScore = 0;
  let totalWeight = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const answer = answers[i] ?? "";
    weightedScore += scoreAnswer(q, answer) * q.weight;
    totalWeight += q.weight;
  }
  return totalWeight === 0 ? 0 : weightedScore / totalWeight;
}

// ── Tick (advertising) ────────────────────────────────────────────────────────

export const quizmasterTick = Effect.fn("quizmasterTick")(function* (ghostId: string) {
  const mcp = yield* GhostMcpService;
  const state = getState(ghostId);
  if (state.phase !== "idle") return;

  const exam = examByGhostId.get(ghostId);
  if (!exam) return;

  const inboxResult = yield* mcp.inbox.pipe(
    Effect.orElseSucceed(() => ({ notifications: [] as Array<{ thread_id: string; message_id: string }> })),
  );

  for (const n of inboxResult.notifications) {
    const from = n.thread_id;
    if (!from) continue;
    if (getState(ghostId).phase !== "idle") break;
    yield* mcp.say({
      intent: "propose",
      content: `I have ${exam.questions.length} questions for you. Reply **accept** to take the exam.`,
      to: from,
    }).pipe(Effect.orElse(() => Effect.void));
  }
});

// ── Handle accept ─────────────────────────────────────────────────────────────

export const quizmasterHandleAccept = Effect.fn("quizmasterHandleAccept")(function* (
  ghostId: string,
  from: string,
  stakeAmount: number,
) {
  const mcp = yield* GhostMcpService;
  const state = getState(ghostId);
  if (state.phase !== "idle") {
    yield* mcp.say({
      intent: "decline",
      content: "I'm already conducting an exam — try again later.",
      to: from,
    }).pipe(Effect.orElse(() => Effect.void));
    return;
  }

  const exam = examByGhostId.get(ghostId);
  if (!exam) {
    yield* mcp.say({
      intent: "decline",
      content: "No exam loaded yet — come back soon.",
      to: from,
    }).pipe(Effect.orElse(() => Effect.void));
    return;
  }

  const inventoryResult = yield* mcp.inventory.pipe(
    Effect.orElseSucceed(() => ({ ok: false, objects: [], holdings: [] })),
  );
  const stakeHolding = inventoryResult.holdings[0];
  const stakeResource = stakeHolding?.resource;
  if (!stakeResource || (stakeHolding?.qty ?? 0) < stakeAmount) {
    yield* mcp.say({
      intent: "decline",
      content: "I'm all out of credits — nothing to stake right now.",
      to: from,
    }).pipe(Effect.orElse(() => Effect.void));
    return;
  }

  const deadlineMs = Date.now() + 24 * 60 * 60 * 1000;
  const contractResult = yield* mcp.evalContractOpen({
    contractorId: from,
    evaluatorId: ghostId,
    request: `Exam: ${exam.questions.length} questions`,
    stakeResource,
    stakeAmount,
    deadlineMs,
    artifactRef: exam.artifactRef,
    disclosureRef: exam.disclosureRef,
  }).pipe(Effect.orElseSucceed(() => ({ code: "FAILED", message: "unknown" } as const)));

  if (!("contractId" in contractResult)) {
    const reason = contractResult.code === "LedgerError.InsufficientFunds"
      ? "I'm out of credits for this session."
      : `Contract failed: ${contractResult.message ?? "unknown"}`;
    yield* mcp.say({ intent: "decline", content: reason, to: from }).pipe(
      Effect.orElse(() => Effect.void),
    );
    return;
  }

  const { contractId } = contractResult;
  ghostState.set(ghostId, {
    phase: "conducting",
    contractId,
    contestantId: from,
    questionIndex: 0,
    answers: [],
  });

  // Send first question
  const firstQuestion = exam.promptSnippets[0]!;
  yield* mcp.say({
    intent: "question",
    content: `Contract #${contractId} opened. Question 1 of ${exam.questions.length}:\n\n${firstQuestion}`,
    to: from,
  }).pipe(Effect.orElse(() => Effect.void));
});

// ── Handle answer ─────────────────────────────────────────────────────────────

export const quizmasterHandleAnswer = Effect.fn("quizmasterHandleAnswer")(function* (
  ghostId: string,
  from: string,
  text: string,
) {
  const mcp = yield* GhostMcpService;
  const state = getState(ghostId);
  if (state.phase !== "conducting" || state.contestantId !== from) return;

  const exam = examByGhostId.get(ghostId);
  if (!exam) return;

  const answers = [...state.answers, text.trim()];
  const nextIndex = state.questionIndex + 1;

  if (nextIndex < exam.questions.length) {
    // More questions remain
    ghostState.set(ghostId, { ...state, questionIndex: nextIndex, answers });
    const nextSnippet = exam.promptSnippets[nextIndex]!;
    yield* mcp.say({
      intent: "question",
      content: `Question ${nextIndex + 1} of ${exam.questions.length}:\n\n${nextSnippet}`,
      to: from,
    }).pipe(Effect.orElse(() => Effect.void));
    return;
  }

  // All questions answered — assemble submission, evaluate, settle
  const verdict = computeVerdict(exam.questions, answers);

  const submissionParts = exam.questions.map((q, i) => toSubmission(q, answers[i] ?? ""));
  const submissionText = submissionParts.join("\n\n---\n\n");

  // Log per-question exchange (US2 audit trail)
  for (let i = 0; i < exam.questions.length; i++) {
    const q = exam.questions[i]!;
    const answer = answers[i] ?? "";
    log.info({
      kind: "quizmaster.answer-recorded",
      ghostId,
      contractId: state.contractId,
      questionId: q.id,
      questionText: q.promptText,
      contestantAnswer: answer,
      score: scoreAnswer(q, answer),
    });
  }

  yield* mcp.evalContractEvaluate({
    contractId: state.contractId,
    verdict,
  }).pipe(
    Effect.tapError((e) =>
      Effect.sync(() =>
        log.error({ kind: "quizmaster.evaluate-fail", ghostId, contractId: state.contractId, error: String(e) }),
      ),
    ),
    Effect.orElse(() => Effect.void),
  );

  // Reveal full artifact (US2 audit disclosure)
  const fullArtifact = exam.fullSnippets.join("\n\n---\n\n");
  yield* mcp.say({
    intent: "result",
    content: `Exam complete! Your score: ${(verdict * 100).toFixed(0)}%\n\nFull artifact (for auditing):\n\n${fullArtifact}`,
    to: from,
  }).pipe(Effect.orElse(() => Effect.void));

  log.info({
    kind: "quizmaster.exam-complete",
    ghostId,
    contractId: state.contractId,
    contestantId: from,
    verdict,
    submissionLength: submissionText.length,
  });

  ghostState.set(ghostId, { phase: "idle" });
});
