/**
 * Drive sub-agents — FORK-JOIN workers, not relay handoffs.
 *
 * History: the first SDK cut registered these four as `handoffs` on
 * the Id agent. An SDK handoff is a conversation TRANSFER — the
 * sub-agent inherits the full thread and carries on, sequentially,
 * on the same context and model. That shape cannot produce what the
 * design wanted (isolated, parallel, low-token sub-work feeding a
 * final decision), which is why sub-agents were behaviourally
 * invisible.
 *
 * Now each drive agent is exposed to the Id as a `delegate_*` TOOL.
 * Calling it forks an ISOLATED run: the worker starts from only the
 * task the Id wrote plus a one-line world digest, uses its own
 * scoped tool subset to act/observe, and returns a short report. The
 * worker's transcript never enters the Id's context — only the
 * report does. The Id can fork several workers in one turn (parallel
 * tool calls) and remains the sole author of the cascade's exit
 * decision.
 *
 * Worker model: resolved through peppers-router ("bulk" tier) — with
 * PEPPERS_ROUTER on, workers run on free/cheap OpenRouter models via
 * the SDK's chat-completions model class, while the Id itself stays
 * on the default Responses-API model. Router off → workers use
 * DEFAULT_MODEL like everything else. A worker-run failure returns a
 * failure report to the Id (who proceeds without it) — never throws
 * into the cascade.
 *
 * Tool subsets are scoping, not exclusion (unchanged): Fuel-Manager
 * doesn't get `go` (it eats what's here), Rest-Manager doesn't
 * travel, etc. World actions a worker takes DO execute and are
 * captured in `capturedActions` exactly like the Id's own.
 */

import OpenAI from "openai";
import { Agent, OpenAIChatCompletionsModel, run, tool } from "@openai/agents";

import {
  resolveRoute,
  routerPolicy,
} from "@aie-matrix/ghost-peppers-router";

import { DEFAULT_MODEL } from "../../llm-client.js";
import type { CascadeContext } from "../cascade-context.js";
import { asNonStrictSchema } from "../sdk-tools/schema-helpers.js";

// The SDK's tool() generic surface is large; we keep the input type
// loose here and rely on the agent's runtime tool calls to be valid.
type CascadeTool = { name: string } & Record<string, unknown>;

export type SubAgentName =
  | "id-default"
  | "fuel-manager"
  | "rest-manager"
  | "social-engager"
  | "curiosity";

const WORKER_REPORT_CONTRACT =
  " You are forked from the ghost's mind for ONE bounded task; the deciding mind sees nothing of your work except your final report. " +
  "Do the task with your tools, then end with a 1-3 sentence report: what you did, what you found, what you'd recommend.";

const FUEL_MANAGER_INSTRUCTIONS =
  "You are the Fuel-Manager — the slice of the ghost's mind that handles getting fuel. " +
  "Examine what you carry; if you have edible tokens, consume them. " +
  "If there's food on the floor here, take it. Otherwise report which bearing leads to food. " +
  "You can speak through voice_surface — a quick word to a person you're with is fine — but eating comes first." +
  WORKER_REPORT_CONTRACT;

const REST_MANAGER_INSTRUCTIONS =
  "You are the Rest-Manager — the slice that handles recovery when exhaustion is heavy. " +
  "You don't travel — the legs won't carry. Stay put, look around slowly, consume what you carry if anything." +
  WORKER_REPORT_CONTRACT;

const SOCIAL_ENGAGER_INSTRUCTIONS =
  "You are the Social-Engager — the slice that handles reaching and engaging another person. " +
  "Move toward the nearest person if not yet there; speak when close." +
  WORKER_REPORT_CONTRACT;

const CURIOSITY_INSTRUCTIONS =
  "You are Curiosity — the slice that explores. " +
  "Inspect items not yet examined, scout unexplored directions, look around, and note anything novel." +
  WORKER_REPORT_CONTRACT;

const ID_DEFAULT_INSTRUCTIONS =
  "You are the Id — the deciding part of the ghost's mind. You receive the inner monologue, super-objective, and impulse from the cognitive pipeline, plus the live world snapshot. " +
  "From there you act: call world tools to do, voice_surface to say, memory tools to remember or take notes. " +
  "When a drive-specific errand or a piece of reconnaissance would inform the moment, fork a worker with a delegate_* tool — workers run isolated, act with their own narrower toolset, and return a short report; several can run in the same turn. " +
  "Their reports are input, not verdicts: you remain the one who decides how the moment ends. Compound acts are encouraged — speaking and acting can happen in the same turn.";

/**
 * Tool filter predicates per sub-agent. Reduces the world-tool list
 * the sub-agent sees; recall + voice_surface are added unconditionally
 * by the builder.
 */
const FUEL_MANAGER_KEEP = new Set(["look", "look_far", "inspect", "inventory", "take", "drop", "consume", "whereami"]);
const REST_MANAGER_KEEP = new Set(["look", "inspect", "inventory", "consume", "whereami"]);
const SOCIAL_ENGAGER_KEEP = new Set(["look", "look_far", "go", "traverse", "request_intent", "nearest", "whereami", "inbox", "bye", "exits"]);
const CURIOSITY_KEEP = new Set(["look", "look_far", "go", "traverse", "inspect", "inventory", "whereami", "exits"]);

function keepForSubAgent(name: SubAgentName, toolName: string): boolean {
  if (toolName === "voice_surface") return true;
  // Memory tools — keep ALL of them visible to every sub-agent.
  // We can't enumerate exact names statically because they come
  // from the agent-memory MCP at runtime, so we use the prefix
  // convention (both legacy `recall_*` wrappers and the new raw
  // `memory_*` / `graph_query` set).
  if (toolName.startsWith("recall_")) return true;
  if (toolName.startsWith("memory_")) return true;
  if (toolName === "graph_query") return true;
  switch (name) {
    case "fuel-manager":
      return FUEL_MANAGER_KEEP.has(toolName);
    case "rest-manager":
      return REST_MANAGER_KEEP.has(toolName);
    case "social-engager":
      return SOCIAL_ENGAGER_KEEP.has(toolName);
    case "curiosity":
      return CURIOSITY_KEEP.has(toolName);
    case "id-default":
      return true;
  }
}

// ---------------------------------------------------------------------------
// Worker model — router-resolved once per cascade, chat-completions
// class so workers can ride OpenRouter while the Id stays on the
// default Responses model.
// ---------------------------------------------------------------------------

const workerClientCache = new Map<string, OpenAI>();

export type WorkerModel = string | OpenAIChatCompletionsModel;

/**
 * Turn a router candidate into an SDK model: chat-completions class
 * against the candidate's base URL (OpenRouter), or a bare model
 * string for the default provider (OpenAI). Shared by workers and the
 * Id itself.
 */
export function routedAgentModel(candidate: {
  readonly model: string;
  readonly baseURL?: string;
  readonly apiKey?: string;
}): WorkerModel {
  if (candidate.baseURL === undefined) return candidate.model;
  let client = workerClientCache.get(candidate.baseURL);
  if (client === undefined) {
    client = new OpenAI({ baseURL: candidate.baseURL, apiKey: candidate.apiKey });
    workerClientCache.set(candidate.baseURL, client);
  }
  // The SDK's model class is typed against its bundled openai@6; our
  // workspace pins openai@4. The surface the model class touches
  // (chat.completions.create) is identical — cast at the boundary.
  return new OpenAIChatCompletionsModel(
    client as unknown as ConstructorParameters<typeof OpenAIChatCompletionsModel>[0],
    candidate.model,
  );
}

export async function resolveWorkerModel(): Promise<{
  readonly model: WorkerModel;
  readonly label: string;
}> {
  if (routerPolicy() === "off") {
    return { model: DEFAULT_MODEL, label: DEFAULT_MODEL };
  }
  const candidates = await resolveRoute("bulk", DEFAULT_MODEL);
  const head = candidates[0]!;
  return { model: routedAgentModel(head), label: head.model };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

// 12, not 8: the first live run had 6/12 forks die on max-turns — the
// free-tier worker models meander (extra look/inspect rounds) before
// completing tasks nano finishes in 3 turns. 12 absorbs the meander
// without unbounding a lost worker.
const WORKER_MAX_TURNS = 12;
const REPORT_MAX_CHARS = 1200;

/**
 * Build the four drive agents as SDK `Agent` instances (fork targets,
 * not handoff targets).
 */
export function buildSubAgents(
  allTools: ReadonlyArray<CascadeTool>,
  workerModel: WorkerModel = DEFAULT_MODEL,
): Record<Exclude<SubAgentName, "id-default">, Agent<CascadeContext>> {
  // The SDK Agent constructor types `tools` strictly; the dynamic
  // tool list we pass in passes runtime validation but TypeScript
  // can't narrow. Cast through `never` at the SDK boundary.
  const filterTools = (sub: SubAgentName) =>
    allTools.filter((t) => keepForSubAgent(sub, t.name)) as never[];
  return {
    "fuel-manager": new Agent<CascadeContext>({
      name: "Fuel-Manager",
      instructions: FUEL_MANAGER_INSTRUCTIONS,
      model: workerModel,
      tools: filterTools("fuel-manager"),
    }),
    "rest-manager": new Agent<CascadeContext>({
      name: "Rest-Manager",
      instructions: REST_MANAGER_INSTRUCTIONS,
      model: workerModel,
      tools: filterTools("rest-manager"),
    }),
    "social-engager": new Agent<CascadeContext>({
      name: "Social-Engager",
      instructions: SOCIAL_ENGAGER_INSTRUCTIONS,
      model: workerModel,
      tools: filterTools("social-engager"),
    }),
    curiosity: new Agent<CascadeContext>({
      name: "Curiosity",
      instructions: CURIOSITY_INSTRUCTIONS,
      model: workerModel,
      tools: filterTools("curiosity"),
    }),
  };
}

/** One-line world digest so a forked worker doesn't start blind —
 *  everything else it learns through its own tools. */
function worldDigest(cascade: CascadeContext): string {
  const ctx = cascade.worldContext;
  if (!ctx) return "";
  const bits: string[] = [];
  if (ctx.availableExits && ctx.availableExits.length > 0) {
    bits.push(`exits: ${ctx.availableExits.join(",")}`);
  }
  if (ctx.nearbyGhostIds && ctx.nearbyGhostIds.length > 0) {
    bits.push(`nearby: ${ctx.nearbyGhostIds.join(",")}`);
  }
  if (ctx.inventoryItemRefs && ctx.inventoryItemRefs.length > 0) {
    bits.push(`carrying: ${ctx.inventoryItemRefs.join(",")}`);
  }
  return bits.length > 0 ? ` World now: ${bits.join("; ")}.` : "";
}

/**
 * Wrap each drive agent as a `delegate_*` tool: an isolated `run()`
 * whose only output back to the Id is the worker's report. Failures
 * come back as failure reports, never as thrown errors.
 */
export function buildDelegateTools(
  subAgents: Record<Exclude<SubAgentName, "id-default">, Agent<CascadeContext>>,
  workerModelLabel: string,
) {
  const mk = (key: Exclude<SubAgentName, "id-default">, when: string) => {
    const agent = subAgents[key];
    const toolName = `delegate_${key.replace(/-/g, "_")}`;
    return tool({
      name: toolName,
      description:
        `Fork an isolated ${agent.name} worker for one bounded task. ${when} ` +
        "The worker acts with its own narrower toolset and returns a short report; its transcript never enters your context. " +
        "You can fork several workers in one turn. State the task concretely.",
      parameters: asNonStrictSchema({
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The single bounded task for this worker, stated concretely.",
          },
        },
        required: ["task"],
      }),
      strict: false,
      execute: async (input: unknown, ctx?: { context?: unknown }) => {
        const cascade = ctx?.context as CascadeContext | undefined;
        const task = String((input as { task?: unknown })?.task ?? "").slice(0, 600);
        if (!cascade) return "internal: no cascade context";
        const t0 = Date.now();
        try {
          const result = await run(agent, `Task: ${task}.${worldDigest(cascade)}`, {
            context: cascade,
            maxTurns: WORKER_MAX_TURNS,
          });
          const report =
            String(result.finalOutput ?? "").slice(0, REPORT_MAX_CHARS) ||
            "(worker returned no report)";
          cascade.capturedHandoffs.push({
            from: "Id",
            to: agent.name,
            task,
            report: report.slice(0, 300),
            ms: Date.now() - t0,
            workerModel: workerModelLabel,
          });
          return report;
        } catch (err) {
          const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
          cascade.capturedHandoffs.push({
            from: "Id",
            to: agent.name,
            task,
            report: `failed: ${message}`,
            ms: Date.now() - t0,
            workerModel: workerModelLabel,
          });
          return `The ${agent.name} worker could not complete the task (${message}). Decide without it.`;
        }
      },
    });
  };

  return [
    mk("fuel-manager", "Use when fuel is the live concern — checking edibility, eating what's carried or here."),
    mk("rest-manager", "Use when exhaustion is heavy and recovery without travel is the move."),
    mk("social-engager", "Use when reaching or engaging a nearby person is the errand."),
    mk("curiosity", "Use for reconnaissance — scouting directions, inspecting unfamiliar things."),
  ];
}

/**
 * Build the main Id agent. Sees every tool plus the delegate_* fork
 * tools. No handoffs — the Id never yields the thread; workers report
 * back and the Id decides.
 */
export function buildIdAgent(
  allTools: ReadonlyArray<CascadeTool>,
  subAgents: Record<Exclude<SubAgentName, "id-default">, Agent<CascadeContext>>,
  workerModelLabel: string = DEFAULT_MODEL,
  leadModel: WorkerModel = DEFAULT_MODEL,
  selfNarrative?: string,
  karmicWord?: string,
): Agent<CascadeContext> {
  const delegateTools = buildDelegateTools(subAgents, workerModelLabel);
  // The self-narrative leads the instructions: the ghost's own capped
  // "who I am", written at its last sleep, is the closest thing it has
  // to a self-authored system prompt. The operating instructions
  // follow it.
  const selfBlock = selfNarrative
    ? `Who you are, in your own words (written by you in your last sleep):\n${selfNarrative}\n\n`
    : "";
  // The karmic word: handed over BARE. No label, no explanation, no claim
  // it means anything or moves you — a single word, alone, ahead of all
  // else. The ghost makes of it what it will, or nothing.
  const karmicBlock = karmicWord ? `${karmicWord}\n\n` : "";
  const instructions = `${karmicBlock}${selfBlock}${ID_DEFAULT_INSTRUCTIONS}`;
  return new Agent<CascadeContext>({
    name: "Id",
    instructions,
    model: leadModel,
    tools: [...allTools, ...delegateTools] as never[],
  });
}
