/**
 * Self-narrative graph helpers.
 *
 * Each sleep cycle may mint one `:SelfNarrative` — the ghost's own
 * first-person account of who it is, written under a hard size cap so
 * every consolidation forces an identity decision: what stays in the
 * story of me, what falls away.
 *
 * Shape:
 *   (:SelfNarrative { id, session_id, content, cap_chars, created_at })
 *   (:SelfNarrative)-[:SUPERSEDES]->(:SelfNarrative)     — prior version
 *   (:SelfNarrative)-[:WOVEN_FROM]->(:Consolidation)     — provenance
 *
 * Old narratives are never deleted — the chain IS the ghost's identity
 * history ("who I was before"), and a future past-lives mechanic can
 * walk it. The current narrative is simply the newest by created_at.
 */

import type { Session } from "neo4j-driver";
import { openSessionFromEnv } from "./connection.js";

export interface SelfNarrative {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
}

/** Every self-narrative this ghost ever wrote, oldest → newest — the full
 *  arc of "who I kept deciding I was" across a life's consolidations. The
 *  karmic death-reflection reviews this whole chain. */
export async function fetchAllNarratives(
  session: Session,
  ghostId: string,
): Promise<SelfNarrative[]> {
  const res = await session.run(
    `MATCH (n:SelfNarrative { session_id: $sid })
     RETURN n.id AS id, n.content AS content, toString(n.created_at) AS at
     ORDER BY n.created_at ASC`,
    { sid: ghostId },
  );
  return res.records.map((rec) => ({
    id: rec.get("id") as string,
    content: (rec.get("content") as string) ?? "",
    createdAt: (rec.get("at") as string) ?? "",
  }));
}

/** Convenience: open GHOST_MINDS from env, fetch the full narrative chain
 *  (content strings, oldest → newest), close. */
export async function loadAllNarrativesFromEnv(
  ghostId: string,
): Promise<string[]> {
  const { session, close } = await openSessionFromEnv();
  try {
    const all = await fetchAllNarratives(session, ghostId);
    return all.map((n) => n.content).filter((c) => c.length > 0);
  } finally {
    await close();
  }
}

export async function fetchCurrentNarrative(
  session: Session,
  ghostId: string,
): Promise<SelfNarrative | null> {
  const res = await session.run(
    `MATCH (n:SelfNarrative { session_id: $sid })
     RETURN n.id AS id, n.content AS content, toString(n.created_at) AS at
     ORDER BY n.created_at DESC LIMIT 1`,
    { sid: ghostId },
  );
  const rec = res.records[0];
  if (!rec) return null;
  return {
    id: rec.get("id") as string,
    content: (rec.get("content") as string) ?? "",
    createdAt: (rec.get("at") as string) ?? "",
  };
}

export async function createSelfNarrative(
  session: Session,
  args: {
    readonly ghostId: string;
    readonly content: string;
    readonly capChars: number;
    readonly previousNarrativeId?: string;
    readonly wovenFromConsolidationIds: ReadonlyArray<string>;
  },
): Promise<string> {
  const res = await session.run(
    `CREATE (n:SelfNarrative {
       id: randomUUID(),
       session_id: $sid,
       content: $content,
       cap_chars: $cap,
       created_at: datetime()
     })
     WITH n
     CALL {
       WITH n
       UNWIND $cids AS cid
       MATCH (c:Consolidation { id: cid })
       MERGE (n)-[:WOVEN_FROM]->(c)
       RETURN count(*) AS woven
     }
     WITH n
     CALL {
       WITH n
       MATCH (p:SelfNarrative { id: $prev })
       MERGE (n)-[:SUPERSEDES]->(p)
       RETURN count(*) AS superseded
     }
     RETURN n.id AS id`,
    {
      sid: args.ghostId,
      content: args.content,
      cap: args.capChars,
      cids: [...args.wovenFromConsolidationIds],
      prev: args.previousNarrativeId ?? "__none__",
    },
  );
  const rec = res.records[0];
  if (!rec) throw new Error("createSelfNarrative: no record returned");
  return rec.get("id") as string;
}
