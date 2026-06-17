/**
 * Stimulus→action consistency measurement (Step F harness).
 *
 * Rows come from :ReasoningTrace (and :ConsolidatedReasoningTrace —
 * pre-sleep traces get relabelled by consolidation, and the
 * measurement must keep seeing them).
 *
 * Stimulus class — `task` with the "respond to:" prefix stripped and
 * the stimulus-class normaliser applied. Only "respond to:" traces
 * count; "commitment evaluation @ …" traces are bookkeeping.
 *
 * Action — ground truth is the trace's HAS_STEP steps: the first step
 * carrying an `action` property, reduced to its verb ("go n" → "go",
 * "say: …" → "say"). Traces with no action step are "(no-action)".
 * Legacy traces (pre SDK migration) carried the action in
 * `outcome` ("cascade closed: consume") — parsed as fallback.
 */

import type { Session } from "neo4j-driver";

import { normalizeStimulusClass } from "./stimulus-class.js";

export interface StimulusActionRow {
  readonly stimulusClass: string;
  readonly action: string;
  readonly cascadeIndex: number;
  readonly startedAtMs: number;
}

const LEGACY_OUTCOME = /^cascade closed:\s*(\S+)/;
const COUNT_OUTCOME = /^cascade closed:\s*\d+ thoughts?,/;

export function actionVerb(rawAction: string): string {
  const head = rawAction.trim().split(/[\s:]/, 1)[0] ?? "";
  return head.length > 0 ? head : "(no-action)";
}

export async function loadStimulusActionRows(
  session: Session,
  sessionId: string,
): Promise<StimulusActionRow[]> {
  const res = await session.run(
    `MATCH (rt)
     WHERE (rt:ReasoningTrace OR rt:ConsolidatedReasoningTrace)
       AND rt.session_id = $sid
       AND rt.task STARTS WITH 'respond to:'
     OPTIONAL MATCH (rt)-[:HAS_STEP]->(st)
     WHERE st.action IS NOT NULL
     WITH rt, st ORDER BY st.step_number
     WITH rt, collect(st.action) AS actions
     RETURN rt.task AS task, rt.outcome AS outcome, rt.metadata AS metadata,
            actions, rt.started_at.epochMillis AS ms
     ORDER BY ms`,
    { sid: sessionId },
  );

  const rows: StimulusActionRow[] = [];
  for (const rec of res.records) {
    const task = (rec.get("task") as string) ?? "";
    const outcome = (rec.get("outcome") as string | null) ?? "";
    const actions = (rec.get("actions") as string[]) ?? [];
    const ms = Number(rec.get("ms") ?? 0);
    let cascadeIndex = -1;
    const metaRaw = rec.get("metadata");
    if (typeof metaRaw === "string") {
      try {
        const meta = JSON.parse(metaRaw) as { cascade_index?: number };
        if (typeof meta.cascade_index === "number") cascadeIndex = meta.cascade_index;
      } catch {
        /* leave -1 */
      }
    }

    let action: string;
    if (actions.length > 0) {
      action = actionVerb(actions[0]!);
    } else if (COUNT_OUTCOME.test(outcome) || outcome.startsWith("cascade closed: no surface action")) {
      action = "(no-action)";
    } else {
      const m = LEGACY_OUTCOME.exec(outcome);
      action = m ? actionVerb(m[1]!) : "(no-action)";
    }

    rows.push({
      stimulusClass: normalizeStimulusClass(task),
      action,
      cascadeIndex,
      startedAtMs: ms,
    });
  }
  return rows;
}

export interface ClassDistribution {
  readonly stimulusClass: string;
  readonly n: number;
  readonly counts: ReadonlyMap<string, number>;
  readonly entropyBits: number;
}

export function shannonEntropyBits(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const c of counts.values()) total += c;
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function distributionsByClass(
  rows: ReadonlyArray<StimulusActionRow>,
): ClassDistribution[] {
  const byClass = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const counts = byClass.get(r.stimulusClass) ?? new Map<string, number>();
    counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    byClass.set(r.stimulusClass, counts);
  }
  const out: ClassDistribution[] = [];
  for (const [stimulusClass, counts] of byClass) {
    let n = 0;
    for (const c of counts.values()) n += c;
    out.push({
      stimulusClass,
      n,
      counts,
      entropyBits: shannonEntropyBits(counts),
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

export function formatDistribution(d: ClassDistribution): string {
  const parts = [...d.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([action, c]) => `${action}×${c}`)
    .join(", ");
  return `${d.stimulusClass}  n=${d.n}  H=${d.entropyBits.toFixed(3)}b  [${parts}]`;
}
