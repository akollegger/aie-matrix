/**
 * Commitment evaluator — runs after every cascade to maintain the
 * ghost's private debt ledger.
 *
 * Reads the monologue (private, the ghost's actual felt intent), the
 * surface action that was just emitted (public, what the world saw),
 * and the current open ledger. Returns: which existing commitments
 * the latest action satisfied, and any new commitments the cascade
 * minted.
 *
 * The asymmetry between monologue and surface IS the lying mechanism.
 * If the surface said "yes let's all go!" but the monologue's flavor
 * was "I want out of this conversation", the evaluator emits no new
 * commitment — what was said was social lubricant, not a promise.
 * Commitments only form when the inner voice actually means it.
 */

import type {
  Commitment,
  CommitmentLedger,
  SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";
import { ulid } from "ulid";

import { chatJson } from "./llm-client.js";

export interface InvokeCommitmentRequest {
  /** The Id's inner-voice output for this cascade — the private signal. */
  readonly monologue: string;
  /** What the Surface actually did against the world — the public signal. */
  readonly action: SurfaceAction;
  /** Whether the action succeeded — failed actions don't satisfy debts. */
  readonly actionSucceeded: boolean;
  /** Current open commitments, oldest first. */
  readonly ledger: CommitmentLedger;
  /** Cascade index — stamped onto any new commitments for age tracking. */
  readonly cascadeIndex: number;
  /** Ghost's display name — used for first-person framing. */
  readonly selfDisplayName?: string;
}

export interface CommitmentEvaluation {
  /** IDs from `ledger` that were satisfied by this cascade. */
  readonly satisfiedIds: ReadonlyArray<string>;
  /** Brand-new commitments the cascade minted. */
  readonly newCommitments: ReadonlyArray<Commitment>;
  readonly usage:
    | { readonly prompt: number; readonly completion: number; readonly total: number }
    | null;
  readonly userPrompt: string;
  readonly raw: string;
}

const SYSTEM_PROMPT = `You are the private commitment-tracker for a ghost in a hex-tile virtual world. You do NOT speak; you keep the ghost's inner ledger of promises-to-self.

Each cascade you receive:
- The MONOLOGUE — the ghost's private inner voice this turn.
- The PUBLIC ACTION — what the ghost actually said or did in the world this turn.
- The OPEN LEDGER — debts the ghost has made to itself but not yet paid.

Your two jobs, in order:

1) SATISFACTION CHECK. For each open commitment, decide: did this cascade's public action pay it down? Compare the action against the commitment's "recognizes satisfaction" cue. Be strict — only mark satisfied if the action actually fulfills the cue. A failed action does NOT satisfy.

2) NEW COMMITMENTS. Decide whether the cascade minted any new commitment. The rule is asymmetric and important:
   - A new commitment forms ONLY IF the MONOLOGUE shows the ghost actually meant it — i.e. the inner voice committed, decided, resolved, or planned something.
   - If the ghost SPOKE a promise (e.g. said "yes let's go to Black Bart's") but the monologue's flavor was "I want this conversation to end" or "I'll say anything to escape", emit NO commitment. Public speech is for the world; debts are only what the inner voice intended.
   - If the monologue silently resolved on something not spoken — e.g. "I need to actually move", "I'm done talking, I'm going" — that IS a commitment.

Frame commitments first-person and concrete: "head to Black Bart's", "stop talking to Yul", "find the marshall's badge".

For each new commitment, also write a one-line "recognizes_satisfaction" cue describing what future action would clear it. Be precise enough that a later cascade can check. Examples:
- "any movement tool toward the saloon tile"
- "the next non-say action of any kind"
- "an action that involves picking up the badge"
- "leaving the cluster Yul is in"

Output strict JSON only:
{
  "satisfied_ids": ["<id>", "..."],
  "new_commitments": [
    {
      "owed": "<first-person debt, ≤ 12 words>",
      "recognizes_satisfaction": "<one-line cue, ≤ 20 words>"
    }
  ]
}

Most cascades produce zero new commitments. That is correct. Do not invent debts just to fill the array.`;

interface CommitmentEvaluationJson {
  readonly satisfied_ids?: unknown;
  readonly new_commitments?: unknown;
}

function formatActionShort(action: SurfaceAction): string {
  const { kind, ...args } = action;
  const argStr = Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : "";
  return `${kind}${argStr}`;
}

export async function invokeCommitment(
  req: InvokeCommitmentRequest,
): Promise<CommitmentEvaluation> {
  const lines: string[] = [];

  if (req.selfDisplayName) {
    lines.push(`You track commitments for ${req.selfDisplayName}.`);
    lines.push("");
  }

  lines.push("MONOLOGUE (private, this turn):");
  lines.push(req.monologue);
  lines.push("");

  lines.push(
    `PUBLIC ACTION (this turn, ${req.actionSucceeded ? "succeeded" : "FAILED"}):`,
  );
  lines.push(formatActionShort(req.action));
  lines.push("");

  if (req.ledger.length === 0) {
    lines.push("OPEN LEDGER: (empty — no current commitments)");
  } else {
    lines.push("OPEN LEDGER (oldest first):");
    for (const c of req.ledger) {
      const age = Math.max(0, req.cascadeIndex - c.bornAtCascade);
      lines.push(
        `  id=${c.id} age=${age} owed="${c.owed}" satisfies-when="${c.recognizesSatisfaction}"`,
      );
    }
  }
  lines.push("");
  lines.push("Return JSON only.");

  const user = lines.join("\n");

  const { value, usage, raw } = await chatJson<CommitmentEvaluationJson>({
    system: SYSTEM_PROMPT,
    user,
  });

  const satisfiedIds = Array.isArray(value.satisfied_ids)
    ? value.satisfied_ids.filter((x): x is string => typeof x === "string")
    : [];

  const newCommitments: Commitment[] = [];
  if (Array.isArray(value.new_commitments)) {
    const nowMs = Date.now();
    for (const raw of value.new_commitments) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as { owed?: unknown; recognizes_satisfaction?: unknown };
      const owed = typeof r.owed === "string" ? r.owed.trim() : "";
      const cue =
        typeof r.recognizes_satisfaction === "string"
          ? r.recognizes_satisfaction.trim()
          : "";
      if (owed.length === 0 || cue.length === 0) continue;
      newCommitments.push({
        id: ulid(),
        owed,
        recognizesSatisfaction: cue,
        bornAtCascade: req.cascadeIndex,
        bornAtMs: nowMs,
      });
    }
  }

  return { satisfiedIds, newCommitments, usage, userPrompt: user, raw };
}
