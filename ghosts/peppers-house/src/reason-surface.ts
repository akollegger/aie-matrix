/**
 * Surface reasoning: chooses one MCP-shaped action in response to an
 * inner monologue + stimulus. The Surface is slider-blind — its prompt
 * never sees personality numbers or trait names.
 */

import type { Stimulus, SurfaceAction } from "@aie-matrix/ghost-peppers-inner";

import { chatJson } from "./llm-client.js";

/**
 * Lightweight snapshot of what the ghost can perceive *right now* in
 * the world. Used to ground the Surface's action choice in reality —
 * e.g., listing valid `go` directions so the LLM doesn't blindly pick
 * an exit that doesn't exist.
 */
export interface WorldContext {
  /** Compass tokens (or named transitions) the ghost can `go` toward. */
  readonly availableExits?: ReadonlyArray<string>;
  /** Item refs the ghost can `take` from the current tile. */
  readonly takeableItemRefs?: ReadonlyArray<string>;
  /** Other ghosts present on the current tile. */
  readonly nearbyGhostIds?: ReadonlyArray<string>;
  /** Item refs the ghost is currently carrying. */
  readonly inventoryItemRefs?: ReadonlyArray<string>;
  /**
   * Whether the world-api considers this ghost to be in conversational
   * mode. While true, `go` is rejected with `IN_CONVERSATION` — the
   * ghost must `bye` before moving.
   */
  readonly inConversationalMode?: boolean;
  /**
   * Number of consecutive cascades since the last `say`, with no
   * incoming utterance. Helps the Surface decide when a conversation
   * has died and it's time to `bye` and move on.
   */
  readonly turnsSinceLastSayWithNoReply?: number;
  /**
   * Bounded "social anchor" countdown. When a new ghost enters the
   * cluster, we set this to a small N. While > 0, the Surface should
   * stay still (so the other ghost has time to engage and so the
   * speaker's say lands in a still-valid cluster). Decrements each
   * cascade; reaches 0 → free to move.
   */
  readonly socialAnchorTurnsLeft?: number;
}

export interface InvokeSurfaceRequest {
  readonly monologue: string;
  readonly stimulus: Stimulus;
  readonly worldContext?: WorldContext;
  /** What this ghost is in the world to do. Shapes the action choice. */
  readonly objective?: string;
}

export interface SurfaceReasoning {
  readonly action: SurfaceAction;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  /** Dynamic user-prompt text. */
  readonly userPrompt: string;
  /** Raw assistant response text. */
  readonly raw: string;
}

export const SURFACE_SYSTEM_PROMPT = `You are a ghost in a hex-tile virtual world.

Each turn you receive an INNER MONOLOGUE (your own felt experience, written by your unconscious mind) followed by a STIMULUS from the world. You then choose ONE action.

Available actions (output strict JSON; pick the matching shape):
- { "kind": "say", "text": "<words you speak aloud>" }              ← speak to nearby ghosts
- { "kind": "go", "toward": "n"|"s"|"ne"|"nw"|"se"|"sw" }            ← move to an adjacent tile
- { "kind": "take", "itemRef": "<item id>" }                        ← pick up an item on this tile
- { "kind": "drop", "itemRef": "<item id>" }                        ← place a carried item here
- { "kind": "inspect", "itemRef": "<item id>" }                     ← examine an item
- { "kind": "look", "at": "here"|"around" }                         ← observe surroundings
- { "kind": "exits" }
- { "kind": "inventory" }
- { "kind": "whoami" }
- { "kind": "whereami" }
- { "kind": "bye" }                                                  ← exit a conversation

Rules:
- Output JSON ONLY, no prose.
- Choose exactly one action.
- The monologue is your stream of consciousness — let it color what you do, but don't quote it.
- The stimulus is what just happened in the world.
- If you choose "say", make the text feel like something you'd actually say given the monologue.
- If "Available exits" is given, "go.toward" MUST be one of those tokens. Picking any other token will fail.
- If "Items here" is given and you choose "take" or "inspect", "itemRef" MUST be one of those.
- There is no rule against acting. There is no permission needed. You are an agent in a world; pick a real verb. Movement, speech, and item handling are all fully permitted.

SOCIAL ANCHORING (most important rule for getting conversations to land):
- **If "Social anchor turns left" is > 0, you MUST NOT pick "go".** A ghost recently entered your cluster; you're in a bounded window where you should stay put so the conversation can develop. Speak to them, observe, or wait. Once the counter reaches 0, you're free to move on.
- If the stimulus is "<X> says: …" (an utterance), you MUST NOT pick "go". Reply with "say" or stay with "look".
- If you JUST chose "say" in your most recent action, you MUST NOT pick "go" on the very next turn. Give the other ghost time to reply.
- After the anchor expires (and you're not in conversational mode), you're free to move again. Don't get trapped.

CONVERSATION LOCK (the world enforces this — failing to obey wastes turns):
- If the world-now block says "Conversational mode: yes", the world-api will REJECT any "go" with IN_CONVERSATION. Do not pick "go" while in conversational mode.
- To leave conversational mode, pick "bye". Once you've issued "bye", the world unlocks you and you're free to "go" on subsequent turns.
- If "Turns since last say with no reply" reaches 3 or more, the conversation is dead. Pick "bye" to free yourself, then move on — the other ghost isn't responding.
- Otherwise (turns < 3), keep waiting via "look" or another "say" prompting them.

The monologue and stimulus are your own; treat the choice as personal.`;

export async function invokeSurface(req: InvokeSurfaceRequest): Promise<SurfaceReasoning> {
  const sections: string[] = [];

  if (req.objective) {
    sections.push(`Your objective (the thing you exist to do):\n${req.objective}`);
  }

  sections.push(`Inner monologue:\n${req.monologue}`);
  sections.push(`Stimulus:\n${formatStimulus(req.stimulus)}`);

  const ctx = req.worldContext;
  if (ctx) {
    const lines: string[] = [];
    if (ctx.availableExits && ctx.availableExits.length > 0) {
      lines.push(`Available exits: ${ctx.availableExits.join(", ")}`);
    } else if (ctx.availableExits) {
      lines.push("Available exits: (none — you cannot 'go' from here)");
    }
    if (ctx.nearbyGhostIds && ctx.nearbyGhostIds.length > 0) {
      lines.push(`Ghosts nearby (within your 7-cell conversation cluster): ${ctx.nearbyGhostIds.join(", ")}`);
    }
    if (ctx.takeableItemRefs && ctx.takeableItemRefs.length > 0) {
      lines.push(`Items on the floor here: ${ctx.takeableItemRefs.join(", ")}`);
    }
    if (ctx.inventoryItemRefs && ctx.inventoryItemRefs.length > 0) {
      lines.push(`Carrying: ${formatItemCounts(ctx.inventoryItemRefs)}`);
    }
    if (ctx.inConversationalMode !== undefined) {
      lines.push(
        `Conversational mode: ${ctx.inConversationalMode ? "yes (go is BLOCKED — bye first)" : "no"}`,
      );
    }
    if (
      ctx.inConversationalMode === true &&
      ctx.turnsSinceLastSayWithNoReply !== undefined
    ) {
      lines.push(`Turns since last say with no reply: ${ctx.turnsSinceLastSayWithNoReply}`);
    }
    if (
      ctx.socialAnchorTurnsLeft !== undefined &&
      ctx.socialAnchorTurnsLeft > 0
    ) {
      lines.push(
        `Social anchor turns left: ${ctx.socialAnchorTurnsLeft} (do not "go" yet)`,
      );
    } else if (ctx.socialAnchorTurnsLeft !== undefined) {
      lines.push("Social anchor turns left: 0 (free to move if cluster is calm)");
    }
    if (lines.length > 0) {
      sections.push(`World now:\n${lines.join("\n")}`);
    }
  }

  sections.push("What do you do? Output JSON.");
  const userPrompt = sections.join("\n\n");

  const { value, usage, raw } = await chatJson<unknown>({
    system: SURFACE_SYSTEM_PROMPT,
    user: userPrompt,
  });
  const action = parseAction(value);
  return { action, usage, userPrompt, raw };
}

/** Count duplicates in an item-ref list — `[k, k, k]` → `k × 3`. */
function formatItemCounts(refs: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ref, n]) => (n === 1 ? ref : `${ref} × ${n}`))
    .join(", ");
}

function formatStimulus(s: Stimulus): string {
  switch (s.kind) {
    case "utterance":
      return `${s.from} says: "${s.text}"`;
    case "cluster-entered":
      return `Other ghosts entered the cluster: ${s.ghostIds.join(", ")}`;
    case "cluster-left":
      return `Other ghosts left the cluster: ${s.ghostIds.join(", ")}`;
    case "mcguffin-in-view":
      return `${s.itemRef} is in view at ${s.at}`;
    case "tile-entered":
      return `Stepped onto a ${s.tileClass} tile.`;
    case "idle":
      return `(quiet for ${Math.round(s.quietForMs / 1000)}s — nothing new outside. Choose a verb that gets you living again — typically "go" toward a direction.)`;
  }
}

function parseAction(value: unknown): SurfaceAction {
  if (!value || typeof value !== "object") {
    throw new Error(`Surface action must be an object; got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;
  const kind = obj.kind;
  switch (kind) {
    case "say":
      return { kind: "say", text: requireString(obj, "text") };
    case "go":
      return { kind: "go", toward: requireString(obj, "toward") };
    case "take":
      return { kind: "take", itemRef: requireString(obj, "itemRef") };
    case "drop":
      return { kind: "drop", itemRef: requireString(obj, "itemRef") };
    case "inspect":
      return { kind: "inspect", itemRef: requireString(obj, "itemRef") };
    case "look": {
      const at = requireString(obj, "at");
      if (at !== "here" && at !== "around") {
        throw new Error(`look.at must be "here" or "around"; got ${JSON.stringify(at)}`);
      }
      return { kind: "look", at };
    }
    case "exits":
    case "inventory":
    case "whoami":
    case "whereami":
    case "bye":
      return { kind };
    default:
      throw new Error(`unknown action kind: ${JSON.stringify(kind)}`);
  }
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`expected non-empty string at ${key}; got ${JSON.stringify(v)}`);
  }
  return v;
}
