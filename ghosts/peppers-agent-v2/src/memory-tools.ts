/**
 * Pull-tools that let the Surface fetch memory adaptively, instead of
 * receiving a flat timeline block every cascade.
 *
 * Step 6 of the v2 surgical roadmap. Memory shifts from PUSH ("here's
 * everything that might be relevant, you figure out what matters") to
 * PULL ("when you want to remember something, call the tool"). The
 * model decides when its decision needs grounding in the past, and
 * the substrate's Step-4 gate decides what's actually reachable.
 *
 * All four recall tools share two properties:
 *   1. Output is a felt-vocabulary STRING, not JSON. The model never
 *      sees raw cascade timestamps or message ids — it reads what the
 *      memory *feels like* from the inside.
 *   2. Step 4's memory gate runs on every call. A ghost that's frayed
 *      or starving will get truncated results + a "fog" prefix
 *      describing how the unreachable past feels.
 */

import type { NeedProfile } from "@aie-matrix/ghost-peppers-inner";
import {
  fetchOccupantImpressions,
  fetchRecentActionDigest,
  fetchRecentCascades,
  fetchRecentDialogueWith,
  type DialogueTurn,
  type MemoryClient,
} from "@aie-matrix/ghost-peppers-mem";

import { feltDurationFromGap } from "./felt.js";
import {
  gateOccupantImpressions,
  gateRecencyDepth,
} from "./memory-gate.js";
import type { ToolSchema } from "./llm-client.js";

/** Per-cascade context the executors need (memory client + which
 *  ghost is asking + when in time + who's around). The Surface
 *  constructs this once and passes it on every recall handoff. */
export interface MemoryToolContext {
  readonly memoryClient: MemoryClient;
  readonly selfGhostId: string;
  readonly needs: NeedProfile;
  /** Absolute cascade index the recall is being made FROM. Used to
   *  render gaps as felt durations ("a moment ago", "earlier"). */
  readonly currentCascadeIndex: number;
  /** Display-name → ghostId lookup for ghosts the running ghost
   *  knows about — built by the Surface from worldContext.nearbyGhosts
   *  plus any longer-term acquaintance set the substrate exposes. */
  readonly knownGhosts: ReadonlyMap<string, string>;
}

/** Tool names the Surface must intercept as recalls (not world actions). */
export const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "recall_dialogue_with",
  "recall_recent_actions",
  "recall_impression_of",
  "recall_recent_cascades",
]);

/**
 * The four recall tools. Surface adds these to the live MCP menu
 * before invoking the model so the LLM sees them alongside world
 * actions. The tool_choice=required contract still applies — picking
 * a recall counts as the cascade's tool choice for this round of the
 * Surface tool-loop; the loop then re-prompts so the model can decide
 * its actual world action.
 */
export const MEMORY_TOOL_SCHEMAS: ReadonlyArray<ToolSchema> = [
  {
    name: "recall_dialogue_with",
    description:
      "Recall what you and another specific person have said to each other recently. Use when you need to remember whether you've already introduced yourselves, what was promised, or what tone the exchange had.",
    inputSchema: {
      type: "object",
      properties: {
        person: {
          type: "string",
          description:
            "The other person's display name (e.g. 'Django Decypher'). Not a routing id.",
        },
        depth: {
          type: "integer",
          description: "How many recent turns to pull. Default 5.",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["person"],
      additionalProperties: false,
    },
  },
  {
    name: "recall_recent_actions",
    description:
      "Recall what you yourself have recently done and how those actions went. Use when you suspect you've just been repeating yourself, or when the outcome of your last move matters.",
    inputSchema: {
      type: "object",
      properties: {
        depth: {
          type: "integer",
          description: "How many recent actions to pull. Default 5.",
          minimum: 1,
          maximum: 20,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "recall_impression_of",
    description:
      "Recall your most recent spatial impression of another person — how they appeared, what they were doing, last seen where. Use when their presence (or absence) shapes what you'd do next.",
    inputSchema: {
      type: "object",
      properties: {
        person: {
          type: "string",
          description: "The other person's display name.",
        },
      },
      required: ["person"],
      additionalProperties: false,
    },
  },
  {
    name: "recall_recent_cascades",
    description:
      "Recall the broad strokes of what's been happening for you across the last few moments — your own thoughts, what triggered them, how it played out. Use when you've lost the thread of where you were going.",
    inputSchema: {
      type: "object",
      properties: {
        depth: {
          type: "integer",
          description: "How many recent cascades to summarise. Default 3.",
          minimum: 1,
          maximum: 10,
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
];

/**
 * Execute one recall tool call. Returns a felt-vocabulary string the
 * Surface tool-loop can pass back to the model as function_call_output.
 *
 * Errors are converted to in-band felt strings ("you reach for it and
 * find nothing") rather than thrown — a recall failure should not
 * abort the cascade, just signal absence.
 */
export async function executeMemoryTool(
  name: string,
  args: Record<string, unknown>,
  ctx: MemoryToolContext,
): Promise<string> {
  switch (name) {
    case "recall_dialogue_with":
      return await recallDialogueWith(args, ctx);
    case "recall_recent_actions":
      return await recallRecentActions(args, ctx);
    case "recall_impression_of":
      return await recallImpressionOf(args, ctx);
    case "recall_recent_cascades":
      return await recallRecentCascades(args, ctx);
    default:
      return `(internal) unknown recall tool: ${name}`;
  }
}

// ---- Renderers ----

function fogPrefix(fog: string | null): string {
  return fog === null ? "" : `(${fog}) `;
}

async function recallDialogueWith(
  args: Record<string, unknown>,
  ctx: MemoryToolContext,
): Promise<string> {
  const person = typeof args["person"] === "string" ? args["person"].trim() : "";
  const depth =
    typeof args["depth"] === "number" && Number.isFinite(args["depth"])
      ? Math.max(1, Math.floor(args["depth"]))
      : 5;
  if (person.length === 0) {
    return "(no name given — nothing to recall)";
  }
  const otherId = ctx.knownGhosts.get(person);
  if (otherId === undefined) {
    return `(you can't recall a clear memory by the name "${person}" — they're not someone you have a thread with right now)`;
  }
  const gate = gateRecencyDepth(ctx.needs, depth);
  if (gate.effective <= 0) {
    return `${fogPrefix(gate.fog)}you reach for what passed between you and ${person} and the page is dark.`;
  }
  let turns: ReadonlyArray<DialogueTurn> = [];
  try {
    const map = await fetchRecentDialogueWith(
      ctx.memoryClient,
      ctx.selfGhostId,
      [{ ghostId: otherId, displayName: person }],
      gate.effective,
    );
    turns = map.get(otherId) ?? [];
  } catch (err) {
    return `${fogPrefix(gate.fog)}(reaching for the memory throws static: ${(err as Error).message})`;
  }
  if (turns.length === 0) {
    return `${fogPrefix(gate.fog)}you've never spoken with ${person} — or if you have, nothing of it has stuck.`;
  }
  const lines = turns.map((t) => {
    const gap =
      t.cascadeIndex === null
        ? "a while back"
        : feltDurationFromGap(ctx.currentCascadeIndex - t.cascadeIndex);
    const speaker = t.by === "self" ? "you" : person;
    return `  - ${gap}: ${speaker}: "${t.text}"`;
  });
  return `${fogPrefix(gate.fog)}what's passed between you and ${person}:\n${lines.join("\n")}`;
}

async function recallRecentActions(
  args: Record<string, unknown>,
  ctx: MemoryToolContext,
): Promise<string> {
  const depth =
    typeof args["depth"] === "number" && Number.isFinite(args["depth"])
      ? Math.max(1, Math.floor(args["depth"]))
      : 5;
  const gate = gateRecencyDepth(ctx.needs, depth);
  if (gate.effective <= 0) {
    return `${fogPrefix(gate.fog)}you reach for what you just did and find the page dark.`;
  }
  let entries: Awaited<ReturnType<typeof fetchRecentActionDigest>> = [];
  try {
    entries = await fetchRecentActionDigest(
      ctx.memoryClient,
      ctx.selfGhostId,
      gate.effective,
    );
  } catch (err) {
    return `${fogPrefix(gate.fog)}(reaching for the memory throws static: ${(err as Error).message})`;
  }
  if (entries.length === 0) {
    return `${fogPrefix(gate.fog)}you've not done anything yet that's left an imprint.`;
  }
  const lines = entries.map((e) => {
    const gap =
      e.cascadeIndex === null
        ? "a while back"
        : feltDurationFromGap(ctx.currentCascadeIndex - e.cascadeIndex);
    const verdict =
      e.outcome === "denied"
        ? " — denied"
        : e.outcome === "failed"
          ? " — failed"
          : "";
    return `  - ${gap}: ${e.summary}${verdict}`;
  });
  return `${fogPrefix(gate.fog)}what you've been doing:\n${lines.join("\n")}`;
}

async function recallImpressionOf(
  args: Record<string, unknown>,
  ctx: MemoryToolContext,
): Promise<string> {
  const person = typeof args["person"] === "string" ? args["person"].trim() : "";
  if (person.length === 0) {
    return "(no name given — nothing to recall)";
  }
  const otherId = ctx.knownGhosts.get(person);
  if (otherId === undefined) {
    return `(you can't picture anyone named "${person}" — that name doesn't bring a face)`;
  }
  const accessGate = gateOccupantImpressions(ctx.needs);
  if (!accessGate.accessible) {
    return `${fogPrefix(accessGate.fog)}you try to picture ${person} and only the haze comes.`;
  }
  let impression: import("@aie-matrix/ghost-peppers-mem").ImpressionView | undefined;
  try {
    const map = await fetchOccupantImpressions(
      ctx.memoryClient,
      ctx.selfGhostId,
      [{ ghostId: otherId, displayName: person }],
    );
    impression = map.get(otherId);
  } catch (err) {
    return `(reaching for the memory throws static: ${(err as Error).message})`;
  }
  if (!impression) {
    return `you reach for what ${person} felt like the last time you saw them and find no clear picture.`;
  }
  const gap =
    impression.cascadeIndex === null
      ? "a while back"
      : feltDurationFromGap(ctx.currentCascadeIndex - impression.cascadeIndex);
  return `last impression of ${person}, from ${gap}: ${impression.snippet}`;
}

async function recallRecentCascades(
  args: Record<string, unknown>,
  ctx: MemoryToolContext,
): Promise<string> {
  const depth =
    typeof args["depth"] === "number" && Number.isFinite(args["depth"])
      ? Math.max(1, Math.floor(args["depth"]))
      : 3;
  const gate = gateRecencyDepth(ctx.needs, depth);
  if (gate.effective <= 0) {
    return `${fogPrefix(gate.fog)}you reach for what's been happening and find the page dark.`;
  }
  let cascades: Awaited<ReturnType<typeof fetchRecentCascades>> = [];
  try {
    cascades = await fetchRecentCascades(
      ctx.memoryClient,
      ctx.selfGhostId,
      gate.effective,
    );
  } catch (err) {
    return `${fogPrefix(gate.fog)}(reaching for the memory throws static: ${(err as Error).message})`;
  }
  if (cascades.length === 0) {
    return `${fogPrefix(gate.fog)}nothing's settled into memory yet — you're at the start.`;
  }
  // The cascade rows are oldest-first from .reverse()? Check fetcher.
  // fetchRecentCascades returns newest first. Render oldest-first so it
  // reads forward in time.
  const oldestFirst = [...cascades].reverse();
  const lines = oldestFirst.map((c) => {
    const task = c.task ?? "(unstated)";
    const outcome = c.outcome ?? (c.success === true ? "landed" : c.success === false ? "didn't land" : "open");
    return `  - was reaching for "${task}", ended up: ${outcome}`;
  });
  return `${fogPrefix(gate.fog)}the recent thread of what's been happening:\n${lines.join("\n")}`;
}
