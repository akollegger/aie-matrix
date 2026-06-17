/**
 * Cascade-time Skill recall (sleep pipeline, Step D).
 *
 * A ghost that has slept owns `:Skill` nodes — AIP procedures distilled
 * from its own consolidated experience, each carrying a
 * `trigger_summary` + `intent_embedding` (1536-d text-embedding-3-small,
 * same model/dim as the rest of the sleep pipeline).
 *
 * Per cascade: normalise the stimulus to its class, embed it (cached
 * per class — repeat stimuli cost nothing), cosine-match against the
 * ghost's loaded skills, and surface the best match above threshold.
 * The match is injected into the Id's prompts as a HINT — remembered
 * know-how the model can take or ignore. Never an override; the
 * substrate surfaces the memory, the LLM still chooses.
 *
 * Threshold: cosine ≥ PEPPERS_SKILL_MATCH_THRESHOLD (default 0.85 per
 * the sleep spec; tune from match logs).
 */

import OpenAI from "openai";
import { parse as yamlParse } from "yaml";

import {
  fetchCurrentNarrative,
  normalizeStimulusClass,
  openSessionFromEnv,
  type AipProcedure,
} from "@aie-matrix/ghost-peppers-sleep";

const EMBED_MODEL = "text-embedding-3-small";

export interface LoadedSkill {
  readonly id: string;
  readonly triggerSummary: string;
  readonly procedure: AipProcedure;
  /** Whole-summary embedding as stored on the :Skill node. */
  readonly embedding: ReadonlyArray<number>;
  /** Per-clause embeddings of trigger_summary split on "; ". A
   *  compound summary ("Food in view; cascade reaches a commitment
   *  evaluation point") dilutes whole-summary cosine below threshold
   *  even when one clause matches the stimulus exactly (measured
   *  0.625 vs 1.000 in the first live run). Matching takes the MAX
   *  over clauses + whole summary. */
  readonly clauseEmbeddings: ReadonlyArray<ReadonlyArray<number>>;
}

export interface SkillMatch {
  readonly skillId: string;
  readonly similarity: number;
  readonly triggerSummary: string;
  /** One-line purpose — threaded into synthesis as felt familiarity. */
  readonly purpose: string;
  /** Full behavioural fragment — threaded into the action stage. */
  readonly hintText: string;
}

function cosine(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Render the procedure as an AIP skill — an instruction set the ghost
 * knows how to run, not a wistful memory. AIP procedures ARE agentic
 * instructions (purpose + ordered, imperative steps); presenting them as
 * "a memory, not an instruction" was why a perfectly-matched forage skill
 * never drove action. Behaviour, never phrases — but instructional.
 */
function renderHint(procedure: AipProcedure): string {
  const lines: string[] = [];
  lines.push(`You know how to handle this. ${procedure.purpose}`);
  const stepLines = procedure.steps
    .map((s, i) => {
      const desc = s["description"] ?? s["name"];
      return typeof desc === "string" && desc.length > 0 ? `  ${i + 1}. ${desc}` : null;
    })
    .filter((s): s is string => s !== null);
  if (stepLines.length > 0) {
    lines.push("Follow these steps:");
    lines.push(...stepLines);
  }
  if (procedure.do_not_use_when && procedure.do_not_use_when.length > 0) {
    lines.push(`Skip this when: ${procedure.do_not_use_when.join("; ")}.`);
  }
  return lines.join("\n");
}

export class SkillRecall {
  private readonly ghostId: string;
  private readonly threshold: number;
  private readonly openai: OpenAI;
  private skills: LoadedSkill[] = [];
  private readonly embedCache = new Map<string, ReadonlyArray<number>>();
  /** The ghost's current self-narrative ("who I am", written by the
   *  ghost itself at its last sleep). Null until the first blackout
   *  mints one. Reloaded together with skills — sleep is the only
   *  thing that changes either. */
  private currentNarrative: string | null = null;

  get narrative(): string | null {
    return this.currentNarrative;
  }

  constructor(ghostId: string) {
    this.ghostId = ghostId;
    this.threshold = Number(process.env.PEPPERS_SKILL_MATCH_THRESHOLD ?? "0.85");
    this.openai = new OpenAI();
  }

  get count(): number {
    return this.skills.length;
  }

  /** (Re)load this ghost's Skills from Neo4j. Call at spawn and after
   *  every wake — sleeping is the only thing that mints new Skills. */
  async reload(): Promise<number> {
    const { session, close } = await openSessionFromEnv();
    try {
      const narrative = await fetchCurrentNarrative(session, this.ghostId);
      this.currentNarrative = narrative?.content ?? null;
      const res = await session.run(
        `MATCH (s:Skill { session_id: $sid })
         WHERE s.intent_embedding IS NOT NULL
         RETURN s.id AS id, s.trigger_summary AS trigger,
                s.procedure_yaml AS proc_yaml, s.procedure_json AS proc,
                s.intent_embedding AS emb`,
        { sid: this.ghostId },
      );
      const pending: Array<Omit<LoadedSkill, "clauseEmbeddings"> & { clauses: string[] }> = [];
      for (const rec of res.records) {
        try {
          const triggerSummary = (rec.get("trigger") as string) ?? "";
          // AIP procedures are YAML; prefer the native form, fall back to the
          // JSON mirror for skills minted before YAML storage.
          const yamlText = rec.get("proc_yaml") as string | null;
          const procedure = (yamlText
            ? yamlParse(yamlText)
            : JSON.parse(rec.get("proc") as string)) as AipProcedure;
          pending.push({
            id: rec.get("id") as string,
            triggerSummary,
            procedure,
            embedding: rec.get("emb") as number[],
            clauses: triggerSummary
              .split(";")
              .map((c) => c.trim())
              .filter((c) => c.length > 0),
          });
        } catch {
          /* malformed procedure_json — skip this skill */
        }
      }
      // One batch embedding call for every clause across all skills.
      const allClauses = pending.flatMap((p) => p.clauses);
      const clauseVectors = new Map<string, ReadonlyArray<number>>();
      if (allClauses.length > 0) {
        const res2 = await this.openai.embeddings.create({
          model: EMBED_MODEL,
          input: allClauses,
        });
        allClauses.forEach((clause, i) => {
          clauseVectors.set(clause, res2.data[i]!.embedding);
        });
      }
      this.skills = pending.map(({ clauses, ...skill }) => ({
        ...skill,
        clauseEmbeddings: clauses
          .map((c) => clauseVectors.get(c))
          .filter((v): v is ReadonlyArray<number> => v !== undefined),
      }));
      return this.skills.length;
    } finally {
      await close();
    }
  }

  /** Best skill match for this stimulus, or null below threshold. */
  async match(stimulusText: string): Promise<SkillMatch | null> {
    if (this.skills.length === 0) return null;
    const cls = normalizeStimulusClass(stimulusText);
    let embedding = this.embedCache.get(cls);
    if (embedding === undefined) {
      const res = await this.openai.embeddings.create({
        model: EMBED_MODEL,
        input: cls,
      });
      embedding = res.data[0]!.embedding;
      this.embedCache.set(cls, embedding);
    }
    let best: LoadedSkill | null = null;
    let bestSim = -1;
    for (const s of this.skills) {
      let sim = cosine(embedding, s.embedding);
      for (const clauseEmb of s.clauseEmbeddings) {
        const clauseSim = cosine(embedding, clauseEmb);
        if (clauseSim > sim) sim = clauseSim;
      }
      if (sim > bestSim) {
        bestSim = sim;
        best = s;
      }
    }
    if (best === null || bestSim < this.threshold) return null;
    return {
      skillId: best.id,
      similarity: bestSim,
      triggerSummary: best.triggerSummary,
      purpose: best.procedure.purpose,
      hintText: renderHint(best.procedure),
    };
  }
}
