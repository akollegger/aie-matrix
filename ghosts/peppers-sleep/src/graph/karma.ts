/**
 * Karmic-lesson + reincarnation-lineage graph helpers.
 *
 * When a ghost dies it distills its life into a single karmic word. That
 * word is the ONLY thing carried into the next life — a new ghostId with a
 * fresh memory scope. The prior life's memories (`:SelfNarrative`,
 * `:Consolidation`, agent-memory messages — all keyed by the old
 * session_id) are NOT loaded by the new life, but the lineage stays linked
 * so the chain can be walked:
 *
 *   (:Life { session_id })-[:PREVIOUS_LIFE]->(:Life { session_id })  ...
 *   (:KarmicLesson { session_id, word, ... })-[:CARRIED_INTO]->(:Life)
 *
 * "Lose access to all other memories, but the memory chain stays attached"
 * is exactly this: new session_id → clean memory; PREVIOUS_LIFE edges →
 * the chain.
 *
 * Beyond the word, a death also seeds ONE corrective `:Skill` keyed to the
 * new ghostId — an instructional procedure (not a reflection) that the new
 * life's `SkillRecall` loads at spawn and surfaces when the situation
 * recurs. It is an ordinary Skill node (same shape distill-skills mints),
 * so the existing match/replay loop carries it with zero new machinery:
 *
 *   (:Skill { session_id, procedure_json, intent_embedding, karmic:true })-[:SEEDED_INTO]->(:Life)
 */

import type { Session } from "neo4j-driver";
import { openSessionFromEnv } from "./connection.js";
import { IntentEmbedder } from "../llm/embedder.js";
import { procedureToYaml } from "./consolidations.js";

export interface KarmicLesson {
  readonly word: string;
  readonly reflection: string;
  readonly previousGhostId: string | null;
}

export async function recordKarmicLesson(
  session: Session,
  args: {
    /** The NEW life that is born carrying the lesson. */
    readonly ghostId: string;
    /** The life that died to produce it. */
    readonly previousGhostId: string;
    readonly word: string;
    readonly reflection: string;
    readonly deathCause: string;
  },
): Promise<void> {
  await session.run(
    `MERGE (cur:Life { session_id: $sid })
     MERGE (prev:Life { session_id: $prev })
     MERGE (cur)-[:PREVIOUS_LIFE]->(prev)
     CREATE (k:KarmicLesson {
       id: randomUUID(),
       session_id: $sid,
       previous_session_id: $prev,
       word: $word,
       reflection: $reflection,
       death_cause: $cause,
       created_at: datetime()
     })
     CREATE (k)-[:CARRIED_INTO]->(cur)`,
    {
      sid: args.ghostId,
      prev: args.previousGhostId,
      word: args.word,
      reflection: args.reflection,
      cause: args.deathCause,
    },
  );
}

export async function fetchKarmicLesson(
  session: Session,
  ghostId: string,
): Promise<KarmicLesson | null> {
  const res = await session.run(
    `MATCH (k:KarmicLesson { session_id: $sid })
     RETURN k.word AS word, k.reflection AS reflection, k.previous_session_id AS prev
     ORDER BY k.created_at DESC LIMIT 1`,
    { sid: ghostId },
  );
  const rec = res.records[0];
  if (!rec) return null;
  const word = (rec.get("word") as string | null) ?? "";
  if (!word) return null;
  return {
    word,
    reflection: (rec.get("reflection") as string | null) ?? "",
    previousGhostId: (rec.get("prev") as string | null) ?? null,
  };
}

/** Convenience: open GHOST_MINDS from env, record the lesson, close. */
export async function recordKarmicLessonFromEnv(args: {
  readonly ghostId: string;
  readonly previousGhostId: string;
  readonly word: string;
  readonly reflection: string;
  readonly deathCause: string;
}): Promise<void> {
  const { session, close } = await openSessionFromEnv();
  try {
    await recordKarmicLesson(session, args);
  } finally {
    await close();
  }
}

/** Convenience: open GHOST_MINDS from env, fetch this life's lesson, close. */
export async function loadKarmicLessonFromEnv(
  ghostId: string,
): Promise<KarmicLesson | null> {
  const { session, close } = await openSessionFromEnv();
  try {
    return await fetchKarmicLesson(session, ghostId);
  } finally {
    await close();
  }
}

// ---------------------------------------------------------------------------
// Karmic skill — the corrective procedure carried into the next life
// ---------------------------------------------------------------------------

/**
 * Write the corrective skill as a `:Skill` node keyed to the NEW life's
 * session_id — identical shape to a distilled skill (so `SkillRecall` loads
 * and matches it with no special-casing), flagged `karmic` for observability
 * and linked to the Life for lineage.
 */
export async function createKarmicSkill(
  session: Session,
  args: {
    /** The NEW life that is born already knowing the skill. */
    readonly ghostId: string;
    readonly procedureJson: string;
    readonly triggerSummary: string;
    readonly embedding: ReadonlyArray<number>;
  },
): Promise<string> {
  // MERGE on content (trigger + procedure) so a life never accumulates two
  // identical karmic skills — important once lives inherit the WHOLE lineage's
  // skills, since the same lesson (esp. the deterministic fallback procedure)
  // recurs across deaths. Distinct lessons all survive; exact repeats collapse.
  const result = await session.run(
    `MERGE (cur:Life { session_id: $sid })
     MERGE (s:Skill {
       session_id: $sid,
       karmic: true,
       trigger_summary: $trigger_summary,
       procedure_yaml: $procedure_yaml
     })
       ON CREATE SET s.id = randomUUID(),
                     s.procedure_json = $procedure_json,
                     s.intent_embedding = $embedding,
                     s.created_at = datetime()
     MERGE (s)-[:SEEDED_INTO]->(cur)
     RETURN s.id AS id`,
    {
      sid: args.ghostId,
      procedure_json: args.procedureJson,
      procedure_yaml: procedureToYaml(args.procedureJson),
      trigger_summary: args.triggerSummary,
      embedding: args.embedding,
    },
  );
  const id = result.records[0]?.get("id");
  if (typeof id !== "string") {
    throw new Error(`createKarmicSkill: no id returned: ${JSON.stringify(result)}`);
  }
  return id;
}

/**
 * Convenience: open GHOST_MINDS from env, embed the skill's trigger summary
 * (same model/dim as every other Skill so cascade-time cosine is comparable),
 * write the karmic Skill keyed to the new ghostId, close. Best-effort caller
 * should swallow failures — a missing skill just means a less-prepared life.
 */
export async function seedKarmicSkillFromEnv(args: {
  readonly ghostId: string;
  readonly procedureJson: string;
  readonly triggerSummary: string;
}): Promise<string> {
  const { session, close } = await openSessionFromEnv();
  try {
    const embedder = new IntentEmbedder();
    const [embedding] = await embedder.embedBatch([args.triggerSummary]);
    if (!embedding) throw new Error("seedKarmicSkillFromEnv: embedding returned empty");
    return await createKarmicSkill(session, {
      ghostId: args.ghostId,
      procedureJson: args.procedureJson,
      triggerSummary: args.triggerSummary,
      embedding,
    });
  } finally {
    await close();
  }
}

/**
 * Carry EVERY karmic skill the previous life held forward into the new one —
 * not just the skill distilled at this death. Because each life already
 * inherited its own ancestors' karmic skills, copying the predecessor's full
 * set propagates the entire lineage's accumulated know-how down the chain.
 * Re-keys each to the new session_id (so `SkillRecall` loads them) and reuses
 * the stored embedding (no re-embed). Deduped by content, so the identical
 * fallback lesson recurring across deaths doesn't pile up. Returns the count
 * carried.
 */
export async function copyKarmicSkillsForward(
  session: Session,
  args: { readonly fromGhostId: string; readonly toGhostId: string },
): Promise<number> {
  const result = await session.run(
    `MATCH (old:Skill { session_id: $from, karmic: true })
     // Dedup the source set by content first, so two identical ancestral
     // skills can't both create on the new life within this one statement.
     WITH old.trigger_summary AS ts, old.procedure_yaml AS py,
          head(collect(old.procedure_json))   AS pj,
          head(collect(old.intent_embedding)) AS emb
     MERGE (cur:Life { session_id: $to })
     MERGE (s:Skill {
       session_id: $to, karmic: true, trigger_summary: ts, procedure_yaml: py
     })
       ON CREATE SET s.id = randomUUID(), s.procedure_json = pj,
                     s.intent_embedding = emb, s.created_at = datetime(),
                     s.inherited = true
     MERGE (s)-[:SEEDED_INTO]->(cur)
     RETURN count(s) AS carried`,
    { from: args.fromGhostId, to: args.toGhostId },
  );
  const n = result.records[0]?.get("carried");
  return typeof n === "number" ? n : Number(n ?? 0);
}

/** Convenience: open GHOST_MINDS from env, carry the previous life's whole
 *  karmic-skill set onto the new ghostId, close. Best-effort. */
export async function carryKarmicSkillsFromEnv(
  fromGhostId: string,
  toGhostId: string,
): Promise<number> {
  const { session, close } = await openSessionFromEnv();
  try {
    return await copyKarmicSkillsForward(session, { fromGhostId, toGhostId });
  } finally {
    await close();
  }
}
