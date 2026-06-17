/**
 * SDK-route Surface speech rendering — the OpenRouter-correct way to give the
 * Surface short-term voice memory.
 *
 * Step 5 originally moved the Surface to the OpenAI Responses API so a
 * SERVER-side thread (`previous_response_id`) could carry the conversation —
 * "remember as a human would" without resending 400k tokens of context each
 * cascade. But OpenRouter does NOT persist the Responses thread (verified: even
 * an OpenAI model forgets across a `previous_response_id` call through it), so
 * on the live stack that memory was dead and the Surface limped on a 6-line
 * local buffer.
 *
 * This route mirrors what the Id already does and what actually works through
 * OpenRouter: drive the @openai/agents SDK with a BOUNDED client-side
 * conversation thread (resent items, trimmed to {@link MAX_SURFACE_SEGMENTS}).
 * Provider-independent voice continuity; bounded so it never reintroduces the
 * 400k-token bloat. The neo4j conversation tier remains the durable store
 * (`persistCascade` keeps writing it); this is the working voice cache.
 *
 * The legacy Responses-thread route is preserved in `reason-surface.ts` behind
 * `PEPPERS_SURFACE_ROUTE` for anyone running directly against OpenAI, where the
 * native server thread does persist.
 */

import { Agent, run, tool } from "@openai/agents";

import { resolveRoute } from "@aie-matrix/ghost-peppers-router";

import type { MemoryClient } from "@aie-matrix/ghost-peppers-mem";

import { DEFAULT_MODEL, VISION_MODEL, type ToolSchema } from "../llm-client.js";
import type { CascadeContext } from "./cascade-context.js";
import { asNonStrictSchema } from "./sdk-tools/schema-helpers.js";
import { routedAgentModel } from "./sub-agents/index.js";

type ThreadItem = Parameters<typeof run>[1] extends infer I
  ? I extends ReadonlyArray<infer E>
    ? E
    : never
  : never;

// Stateless: the Surface keeps NO structured cross-turn item thread, and NO
// recall tools. Its only memory is the plain-text transcript the caller reads
// from the graph and puts in `userPrompt` — the Surface "directly sees the
// conversation". Each render is a single forced commit_speech call: one
// utterance, no agentic loop to wander in.

export interface RenderViaSdkRequest {
  readonly ghostId: string;
  /** System prompt — identity + voice rules + who-you-are-now (external self). */
  readonly instructions: string;
  /** The render prompt for this turn (intent + world + "commit_speech"). */
  readonly userPrompt: string;
  /** Agent-memory tool schemas for recall (wired as SDK tools). */
  readonly agentMemoryToolSchemas: ReadonlyArray<ToolSchema>;
  /** Memory client the recall tools execute against (via run context). */
  readonly memoryClient: MemoryClient;
  /** Inbound peer lines, injected as real user-role conversation turns. */
  readonly priorPeerLines?: ReadonlyArray<string>;
  /** A painting the Surface is looking at — multimodal part (vision-routed). */
  readonly imageUrl?: string;
  /** Speech model override (else DEFAULT_MODEL; VISION_MODEL when image). */
  readonly speechModel?: string;
  /** Sampling temperature — the Fuel-scaled surface temperature (normal when
   *  fed, wild when starving). Omitted → model default. */
  readonly temperature?: number;
}

export interface RenderViaSdkResult {
  readonly text: string;
  readonly usage: { readonly prompt: number; readonly completion: number; readonly total: number } | null;
  readonly raw: string;
}

const COMMIT_SPEECH = "commit_speech";

export async function renderViaSdk(req: RenderViaSdkRequest): Promise<RenderViaSdkResult> {
  // commit_speech: the Surface's only output path. Captures the rendered
  // sentence via closure; the model calls it once to "say" the line.
  let captured = "";
  const commitTool = tool({
    name: COMMIT_SPEECH,
    description: "Submit the exact sentence you say aloud, in your own voice.",
    parameters: asNonStrictSchema({
      type: "object",
      properties: { text: { type: "string", description: "The sentence to say aloud." } },
      required: ["text"],
    }),
    strict: false,
    execute: async (input: unknown) => {
      const t = (input as { text?: unknown } | null)?.text;
      captured = typeof t === "string" ? t : "";
      return "ok";
    },
  });
  // Vision model when looking at a painting; else the speech/default model.
  // Routed for OpenRouter credentials + slug, same as the Id.
  const lead = req.imageUrl ? VISION_MODEL : (req.speechModel ?? DEFAULT_MODEL);
  const head = (await resolveRoute("bulk", DEFAULT_MODEL, [lead]))[0]!;
  const model = routedAgentModel(head);

  // commit_speech is the ONLY tool and it is FORCED — the Surface composes one
  // utterance and submits it, full stop. No recall tools: the Surface already
  // sees the conversation directly (the transcript in `userPrompt`), so there's
  // nothing to pull and nothing to loop on (the old recall loop blew past
  // maxTurns without ever speaking). One render → one utterance.
  const agent = new Agent<CascadeContext>({
    name: "Surface",
    instructions: req.instructions,
    model,
    tools: [commitTool],
    modelSettings: {
      toolChoice: COMMIT_SPEECH,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    },
  });

  const newItems: ThreadItem[] = [];
  for (const line of req.priorPeerLines ?? []) {
    newItems.push({ role: "user", content: line } as ThreadItem);
  }
  const mainContent: unknown = req.imageUrl
    ? [
        { type: "input_text", text: req.userPrompt },
        { type: "input_image", image: req.imageUrl },
      ]
    : req.userPrompt;
  newItems.push({ role: "user", content: mainContent } as ThreadItem);

  // Forcing a specific tool every turn means the model never emits a terminal
  // assistant message, so the SDK will hit maxTurns even though commit_speech
  // already fired on turn 1. That's expected: we read the captured utterance,
  // and only surface the error if nothing was ever said.
  let result: unknown;
  try {
    result = await run(agent, newItems, { maxTurns: 2 });
  } catch (err) {
    if (captured.trim().length === 0) throw err;
  }

  const u = (result as {
    state?: { usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number } };
  } | undefined)?.state?.usage;
  const usage = u
    ? { prompt: u.inputTokens ?? 0, completion: u.outputTokens ?? 0, total: u.totalTokens ?? 0 }
    : null;

  return { text: captured, usage, raw: JSON.stringify({ committed: captured }) };
}
