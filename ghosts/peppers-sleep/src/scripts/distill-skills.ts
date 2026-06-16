/**
 * Step C — distill each surviving :Consolidation into one AIP
 * procedure, persisted as a :Skill node with [:DISTILLED_TO].
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run distill:skills -- \
 *       --session=<sid> [--commit]
 *
 * Model: the LARGER family sibling (default gpt-5.4-mini-2026-03-17,
 * verified against /v1/models; override with
 * PEPPERS_SLEEP_DISTILL_MODEL). Distillation is abstraction, not
 * content-preservation — nano is not fit for it.
 *
 * Output contract per skill:
 *   - procedure_json   — AIP-conformant (response_format json_schema +
 *                        quickShapeCheck)
 *   - trigger_summary  — DETERMINISTIC: the procedure's trigger_when
 *                        clauses, stimulus-class-normalised and joined.
 *                        Not model-authored prose — this string is the
 *                        cascade-time KNN key, so it must live in the
 *                        same lexical space as live stimuli.
 *   - intent_embedding — 1536-d text-embedding-3-small of
 *                        trigger_summary (same model/dim as everything
 *                        else in the pipeline).
 *
 * Skips Consolidations that already have [:DISTILLED_TO] (idempotent).
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import { createSkill } from "../graph/consolidations.js";
import { PROCEDURE_SCHEMA, quickShapeCheck, type AipProcedure } from "../aip/index.js";
import { NanoClient } from "../llm/nano.js";
import { IntentEmbedder } from "../llm/embedder.js";
import { normalizeStimulusClass } from "../pipeline/stimulus-class.js";
import { isCliEntry } from "./_runtime.js";

loadRootEnv();

const DEFAULT_DISTILL_MODEL = "gpt-5.4-mini-2026-03-17";

const SYSTEM_PROMPT = `You are a skill-distillation worker inside an agent-memory sleep pipeline.

You receive ONE consolidation: a bullet list distilled from a single agent's own lived experience (thoughts, utterances, observations), plus the OBSERVED STIMULUS CLASSES — the exact trigger vocabulary the world uses for the experiences in this consolidation.

Your job is to extract the agent's OWN demonstrated procedural pattern as an AIP procedure — a description of what this agent has tended to do, so the pattern can be surfaced back to it when a similar situation recurs.

Rules:
- The procedure must trace to what the agent ACTUALLY DID in the bullets. Do not invent better behaviour, do not generalise beyond the evidence, do not moralise.
- trigger_when: each clause MUST begin with one of the OBSERVED STIMULUS CLASSES, verbatim. You may append a short qualifier after " — " (e.g. "Food in view — while not already carrying food"). Only include classes whose pattern the bullets actually show. One clause per relevant class.
- steps: each step describes BEHAVIOUR — an action tendency (prefer X, check Y first, avoid Z) — never specific wording or phrases to say.
- do_not_use_when: include any internal-state condition visible in the bullets under which the pattern did NOT hold (e.g. acute hunger overriding it). Omit if none visible.
- purpose: one sentence naming the pattern.
- Keep it small: 1-4 trigger_when clauses, 1-5 steps.`;

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

/**
 * The vendored schema document carries meta keys ($schema, $id, title,
 * description, aip) — observed 2026-06-12 to make the model ECHO the
 * schema document into its output (purpose missing, $id present).
 * Stripping the meta keys fixes conformance; the structural keys
 * (type, properties, required, $defs, additionalProperties) stay.
 */
function sanitizedProcedureSchema(): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...PROCEDURE_SCHEMA };
  for (const k of ["$schema", "$id", "title", "description", "aip"]) {
    delete clean[k];
  }
  return clean;
}

/**
 * Mechanically ground the trigger summary in the observed stimulus
 * classes. Each trigger_when clause must start with an observed class
 * (the system prompt enforces this; we verify here): the clause's
 * pre-" — " head is normalised and kept only if it IS one of the
 * observed classes. Grounded clauses make the trigger_summary live in
 * the exact lexical space cascade-time matching embeds ("Food in
 * view" == "Food in view" → cosine 1.0). Ungrounded clauses fall back
 * to their normalised form (still matchable, just not guaranteed).
 *
 * Measured need (lab runs 1-2): free-prose triggers scored 0.46-0.63
 * against live stimuli — below any usable gate; verbatim class
 * triggers score ~1.0.
 */
export function triggerSummaryOf(
  procedure: AipProcedure,
  observedClasses: ReadonlyArray<string>,
): string {
  const observed = new Set(observedClasses.map((c) => c.toLowerCase()));
  const clauses: string[] = [];
  for (const t of procedure.trigger_when) {
    const head = normalizeStimulusClass(t.split(" — ")[0] ?? t);
    const clause = observed.has(head.toLowerCase()) ? head : normalizeStimulusClass(t);
    if (!clauses.includes(clause)) clauses.push(clause);
  }
  return clauses.join("; ");
}

/**
 * The observed stimulus classes for one Consolidation = the distinct
 * normalised task classes of its source ReasoningTraces (only
 * world-stimulus traces; commitment-evaluation bookkeeping is
 * excluded so it can never become trigger vocabulary).
 */
async function observedClassesOf(
  session: import("neo4j-driver").Session,
  consolidationId: string,
): Promise<string[]> {
  const res = await session.run(
    `MATCH (n)-[:CONSOLIDATED_TO]->(c:Consolidation { id: $cid })
     WHERE n.task STARTS WITH 'respond to:'
     RETURN DISTINCT n.task AS task`,
    { cid: consolidationId },
  );
  const classes = new Set<string>();
  for (const rec of res.records) {
    classes.add(normalizeStimulusClass(rec.get("task") as string));
  }
  return [...classes];
}

export async function runDistillSkills(
  opts: { sessionId: string; commit: boolean },
): Promise<void> {
  const args = { sessionId: opts.sessionId, commit: opts.commit };
  const model = process.env.PEPPERS_SLEEP_DISTILL_MODEL ?? DEFAULT_DISTILL_MODEL;
  console.log(`# session_id:    ${args.sessionId}`);
  console.log(`# mode:          ${args.commit ? "COMMIT" : "DRY RUN"}`);
  console.log(`# distill model: ${model}`);

  const { session, close } = await openSessionFromEnv();
  // tier "quality": never silently routed to a cheap model — distillation
  // is abstraction-grade work (PEPPERS_ROUTER_QUALITY_MODEL can pin an
  // OpenRouter id explicitly).
  const llm = new NanoClient({ model, tier: "quality" });
  const embedder = new IntentEmbedder();

  try {
    const res = await session.run(
      `MATCH (c:Consolidation { session_id: $sid })
       WHERE NOT EXISTS((c)-[:DISTILLED_TO]->())
       RETURN c.id AS id, c.content AS content
       ORDER BY c.created_at`,
      { sid: args.sessionId },
    );
    console.log(`# consolidations to distill: ${res.records.length}`);
    if (res.records.length === 0) return;

    let written = 0;
    for (const rec of res.records) {
      const cid = rec.get("id") as string;
      const content = (rec.get("content") as string) ?? "";
      console.log(`\n# ─── Consolidation ${cid.slice(0, 8)}… ───`);
      const observedClasses = await observedClassesOf(session, cid);
      console.log(`  observed classes: ${observedClasses.join(" | ") || "(none)"}`);

      const raw = await llm.completeStructured(
        [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `OBSERVED STIMULUS CLASSES (trigger_when clauses must each begin with one of these, verbatim):\n${observedClasses.map((c) => `- ${c}`).join("\n") || "- (none observed)"}\n\nConsolidation bullets:\n\n${content}\n\nEmit the AIP procedure JSON now.`,
          },
        ],
        { name: "aip_procedure", schema: sanitizedProcedureSchema() },
      );

      let procedure: AipProcedure;
      try {
        procedure = JSON.parse(raw) as AipProcedure;
      } catch {
        console.log("  SKIP — model emitted unparseable JSON");
        continue;
      }
      const shapeError = quickShapeCheck(procedure);
      if (shapeError !== null) {
        console.log(`  SKIP — shape check failed: ${shapeError}`);
        continue;
      }

      const triggerSummary = triggerSummaryOf(procedure, observedClasses);
      console.log(`  purpose:         ${procedure.purpose}`);
      console.log(`  trigger_summary: ${triggerSummary}`);
      for (const s of procedure.steps) {
        const head = JSON.stringify(s).slice(0, 110);
        console.log(`  step: ${head}`);
      }

      if (args.commit) {
        const [embedding] = await embedder.embedBatch([triggerSummary]);
        const skillId = await createSkill(session, {
          ghostId: args.sessionId,
          procedureJson: JSON.stringify(procedure),
          consolidationId: cid,
          triggerSummary,
        });
        await session.run(
          `MATCH (s:Skill { id: $id }) SET s.intent_embedding = $emb`,
          { id: skillId, emb: embedding },
        );
        written += 1;
        console.log(`  committed: Skill ${skillId}`);
      }
    }
    console.log(
      args.commit
        ? `\n# Wrote ${written} Skills.`
        : "\n# (dry run) — pass --commit to persist",
    );
  } finally {
    await close();
  }
}

if (isCliEntry(import.meta.url)) {
  await runDistillSkills(parseArgs()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
