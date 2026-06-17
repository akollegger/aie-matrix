/**
 * Canonical-text extraction: per source-label, return the prose that
 * represents "what the ghost mentally did in this beat" — the thing
 * we embed into `intent_embedding` for cross-type clustering.
 *
 * Sources span the agent-memory schema:
 *   :Message         — utterance the ghost spoke (or peer spoke at it)
 *   :ReasoningTrace  — one cascade's stimulus → outcome
 *   :Observation     — a noted world fact
 *   :Entity          — a named person/place/thing
 *   :Fact            — a claim about an entity
 *
 * Add new label handlers HERE; the rest of the pipeline (embedder,
 * AGA projection, consolidation prompt, relabel) is label-generic.
 *
 * Each extractor returns a string OR null if the node has nothing
 * embed-worthy (skip during embedding).
 */
import { stripSpeakerPrefix } from "./strip-prefix.js";

export type SourceLabel =
  | "Message"
  | "ReasoningTrace"
  | "Observation"
  | "Entity"
  | "Fact";

export interface CanonicalNode {
  readonly id: string;
  readonly label: SourceLabel;
  /** Raw node properties from Neo4j (already JS-typed). */
  readonly props: Record<string, unknown>;
  /** For :ReasoningTrace — the ordered HAS_STEP children's properties
   *  (thought / action / observation / tool_*). Absent/empty for other
   *  labels. Including them is what lets a cascade's FULL chain — what it
   *  thought, did, and observed — reach embedding and consolidation, rather
   *  than just the task→outcome stub. */
  readonly steps?: ReadonlyArray<Record<string, unknown>>;
}

export function toCanonicalText(node: CanonicalNode): string | null {
  switch (node.label) {
    case "Message": {
      const content = asString(node.props["content"]);
      if (content === null) return null;
      return stripSpeakerPrefix(content);
    }
    case "ReasoningTrace": {
      const task = asString(node.props["task"]);
      const outcome = asString(node.props["outcome"]);
      const stepLines = renderTraceSteps(node.steps ?? []);
      if (task === null && outcome === null && stepLines.length === 0) return null;
      const left = task ?? "(no task)";
      const right = outcome ?? "(no outcome)";
      // The inner chain (monologue, actions+results, observations) carries the
      // ghost's actual felt experience — needs, food, peers. Without it the
      // trace embeds/consolidates on a bare task→outcome stub and the life
      // never reaches the self-narrative.
      const body =
        stepLines.length > 0 ? `\n  · ${stepLines.join("\n  · ")}\n` : " ";
      return `${left}${body}→ ${right}`;
    }
    case "Observation": {
      const content =
        asString(node.props["content"]) ??
        asString(node.props["text"]) ??
        asString(node.props["description"]);
      return content;
    }
    case "Entity": {
      const name = asString(node.props["name"]);
      const desc =
        asString(node.props["description"]) ??
        asString(node.props["role"]);
      if (name === null && desc === null) return null;
      return [name, desc].filter((s) => s !== null).join(" — ");
    }
    case "Fact": {
      const subject = asString(node.props["subject"]);
      const predicate = asString(node.props["predicate"]);
      const object = asString(node.props["object"]);
      const claim = asString(node.props["claim"]) ?? asString(node.props["content"]);
      if (claim !== null) return claim;
      if (subject === null || predicate === null) return null;
      return [subject, predicate, object].filter((s) => s !== null).join(" ");
    }
  }
}

/**
 * Render a ReasoningTrace's ordered steps into compact lines — the inner
 * chain of one cascade: what it thought (the monologue), what it did (with
 * the world's result), and what it observed. Each kept short so the trace
 * embeds/consolidates on its real content without ballooning the vector.
 */
function renderTraceSteps(
  steps: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const lines: string[] = [];
  for (const s of steps) {
    const thought = asString(s["thought"]);
    if (thought !== null) lines.push(`thought: ${clip(thought, 240)}`);

    const tool = asString(s["tool_name"]) ?? asString(s["action"]);
    const result = asString(s["tool_result"]);
    if (tool !== null) {
      lines.push(result !== null ? `did ${tool} → ${clip(result, 160)}` : `did ${tool}`);
    }

    const observation = asString(s["observation"]);
    // Drop the bare action-status observations ("completed" / "denied: …") —
    // the tool_result already carries that. Keep genuine perceptions.
    if (
      observation !== null &&
      observation !== "completed" &&
      !observation.startsWith("denied:")
    ) {
      lines.push(`observed: ${clip(observation, 200)}`);
    }
  }
  return lines;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Cluster-bullet rendering — what the consolidation sub-agent sees
 * for a single source node. The label tag is explicit so a mixed-
 * type cluster reads coherently.
 */
export function toClusterBullet(
  node: CanonicalNode,
  timestamp: string | null,
): string {
  const tag = LABEL_BULLET_TAG[node.label];
  const ts = timestamp ? `[${timestamp}] ` : "";
  const text = toCanonicalText(node) ?? "(empty)";
  return `- ${ts}${tag} ${text}`;
}

const LABEL_BULLET_TAG: Record<SourceLabel, string> = {
  Message: "[Said]",
  ReasoningTrace: "[Thought]",
  Observation: "[Observed]",
  Entity: "[Knows]",
  Fact: "[Claim]",
};

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}
