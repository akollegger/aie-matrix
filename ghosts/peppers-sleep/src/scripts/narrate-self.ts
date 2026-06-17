/**
 * Sleep step — self-narration. After consolidation/cut/distillation,
 * the ghost writes the new story of itself: a literal, human-like,
 * first-person narrative of who it is NOW, woven from its previous
 * narrative ("who I was") and this cycle's surviving consolidations.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run narrate:self -- \
 *       --session=<sid> [--commit]
 *
 * The HARD CAP is the mechanic: PEPPERS_NARRATIVE_MAX_CHARS (default
 * 900). The ghost cannot keep everything — choosing what defines it IS
 * the identity decision the cap forces. Enforcement is mechanical, not
 * advisory: one retry with overflow feedback, then truncation at the
 * last sentence boundary under the cap.
 *
 * Model: quality tier (same rationale as distillation — this is
 * abstraction, not content preservation). Pin elsewhere with
 * PEPPERS_ROUTER_QUALITY_MODEL.
 *
 * Storage: versioned :SelfNarrative chain (never deleted) with
 * [:WOVEN_FROM] provenance to the consolidations it drew on. The
 * waking mind loads only the newest.
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import {
  createSelfNarrative,
  fetchCurrentNarrative,
} from "../graph/narrative.js";
import { NanoClient } from "../llm/nano.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

const DEFAULT_CAP = 900;
const DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17";

const SYSTEM_PROMPT = (cap: number): string =>
  `You are the self-narration step of an agent's sleep — the moment it decides who it is.

You receive the agent's PREVIOUS self-narrative (who it believed it was, written at its last sleep) and the CONSOLIDATED EXPERIENCE from the waking period since then. Write the agent's NEW self-narrative.

What it must be:
- A literal, human-like, first-person story: "who I am now" — and where it matters, how that differs from who I was.
- Woven from the most notable actual events and patterns in the material. Names, places, choices that defined the period stay; routine repetition falls away.
- Continuity is allowed and good: keep what from the previous narrative still feels true; let go of what no longer is.
- Plain prose. No lists, no headers, no meta-commentary.
- HARD LIMIT: ${cap} characters. You cannot keep everything. Choosing what defines you is the task.
- Every claim must trace to the provided material. Do not invent events.`;

interface Args {
  readonly sessionId: string;
  readonly commit: boolean;
}

function parseArgs(): Args {
  let sessionId: string | null = null;
  let commit = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--session=")) sessionId = arg.slice("--session=".length);
    else if (arg === "--commit") commit = true;
    else if (!arg.startsWith("--") && sessionId === null) sessionId = arg;
  }
  if (sessionId === null) throw new Error("--session=<sid> is required");
  return { sessionId, commit };
}

/** Truncate at the last sentence end at or before `cap`; fall back to
 *  a hard cut if no sentence boundary exists in range. */
export function truncateAtSentence(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const head = text.slice(0, cap);
  const lastEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.endsWith(".") || head.endsWith("!") || head.endsWith("?") ? cap - 1 : -1,
  );
  return lastEnd > cap * 0.5 ? head.slice(0, lastEnd + 1).trim() : head.trim();
}

export async function runNarrateSelf(
  opts: { sessionId: string; commit: boolean },
): Promise<void> {
  const args = { sessionId: opts.sessionId, commit: opts.commit };
  const cap = Number(process.env.PEPPERS_NARRATIVE_MAX_CHARS ?? DEFAULT_CAP);
  const model = process.env.PEPPERS_SLEEP_DISTILL_MODEL ?? DEFAULT_MODEL;
  console.log(`# session_id: ${args.sessionId}`);
  console.log(`# mode:       ${args.commit ? "COMMIT" : "DRY RUN"}`);
  console.log(`# cap:        ${cap} chars · model: ${model}`);

  const { session, close } = await openSessionFromEnv();
  const llm = new NanoClient({ model, tier: "quality" });

  try {
    const previous = await fetchCurrentNarrative(session, args.sessionId);
    const sinceClause = previous
      ? `AND c.created_at > datetime($since)`
      : "";
    const res = await session.run(
      `MATCH (c:Consolidation { session_id: $sid })
       WHERE true ${sinceClause}
       RETURN c.id AS id, c.content AS content
       ORDER BY c.created_at`,
      previous
        ? { sid: args.sessionId, since: previous.createdAt }
        : { sid: args.sessionId },
    );
    const consolidations = res.records.map((r) => ({
      id: r.get("id") as string,
      content: (r.get("content") as string) ?? "",
    }));
    console.log(
      `# previous narrative: ${previous ? `${previous.content.length} chars` : "(none — first sleep)"}` +
        ` · new consolidations: ${consolidations.length}`,
    );
    if (consolidations.length === 0 && previous !== null) {
      console.log("# nothing new to narrate — keeping previous narrative");
      return;
    }

    const userPrompt = [
      previous
        ? `PREVIOUS SELF-NARRATIVE (who I was):\n${previous.content}`
        : `PREVIOUS SELF-NARRATIVE: none — this is my first sleep; the narrative below is my first account of myself.`,
      `CONSOLIDATED EXPERIENCE since then:\n${consolidations.map((c) => c.content).join("\n\n")}`,
      `Write the new self-narrative now (max ${cap} characters, first person, plain prose).`,
    ].join("\n\n");

    let narrative = (
      await llm.complete([
        { role: "system", content: SYSTEM_PROMPT(cap) },
        { role: "user", content: userPrompt },
      ])
    ).trim();

    if (narrative.length > cap) {
      console.log(`# draft over cap (${narrative.length}/${cap}) — one retry`);
      narrative = (
        await llm.complete([
          { role: "system", content: SYSTEM_PROMPT(cap) },
          { role: "user", content: userPrompt },
          { role: "assistant", content: narrative },
          {
            role: "user",
            content: `That is ${narrative.length - cap} characters over the ${cap}-character limit. Decide what matters most and rewrite within the limit.`,
          },
        ])
      ).trim();
    }
    if (narrative.length > cap) {
      console.log(`# still over (${narrative.length}/${cap}) — sentence-boundary truncate`);
      narrative = truncateAtSentence(narrative, cap);
    }

    console.log(`\n# ─── new narrative (${narrative.length}/${cap} chars) ───`);
    console.log(narrative);

    if (args.commit) {
      const id = await createSelfNarrative(session, {
        ghostId: args.sessionId,
        content: narrative,
        capChars: cap,
        ...(previous !== null ? { previousNarrativeId: previous.id } : {}),
        wovenFromConsolidationIds: consolidations.map((c) => c.id),
      });
      console.log(`\n# committed: SelfNarrative ${id}`);
    } else {
      console.log("\n# (dry run) — pass --commit to persist");
    }
  } finally {
    await close();
  }
}

if (isCliEntry(import.meta.url)) {
  await runNarrateSelf(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
