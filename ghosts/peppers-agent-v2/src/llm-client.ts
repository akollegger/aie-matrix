/**
 * Thin OpenAI client wrapper. Centralizes the model selection, the
 * JSON-output prompt pattern, and basic error normalization so
 * `reason-id` and `reason-surface` can stay small.
 *
 * The default model is the capable lead for the agentic Id action stage
 * and the final fallback for every routed call. All OpenAI-shaped calls
 * go through OpenRouter (OPENAI_BASE_URL), so this is an OpenRouter slug.
 * Override per call via the `model` arg if you need a different one.
 */

import OpenAI from "openai";

import {
  isFallthroughError,
  resolveRoute,
  routerPolicy,
} from "@aie-matrix/ghost-peppers-router";

/**
 * Project default — the capable Id lead AND the final routing fallback for
 * every routed call. Claude Haiku 4.5 via OpenRouter by default; override
 * with PEPPERS_DEFAULT_MODEL (e.g. to a cheap model so the fallback can
 * never escalate to an expensive one during cost evals). See memory
 * `feedback_model_authority.md`.
 */
// `||` (not `??`) so an empty-string env (compose's `${VAR:-}` default sets
// "", which `??` would NOT catch) falls back to Haiku instead of leaving the
// model name blank.
export const DEFAULT_MODEL =
  process.env.PEPPERS_DEFAULT_MODEL || "anthropic/claude-haiku-4.5";

/** Smallest cheap vision-capable model (RFC-0031). Used for any cascade that
 *  carries an image (a painting a ghost looked at). Env-overridable — model
 *  authority stays operator-side. Default: OpenRouter `openai/gpt-5-nano`. */
export const VISION_MODEL =
  process.env.PEPPERS_VISION_MODEL || "openai/gpt-5-nano";

/** A single LLM exchange. */
export interface ChatJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly model?: string;
  /** Capable lead model(s) (OpenRouter slugs) to head the route ahead of the
   *  free/bulk chain — for high-abstraction one-off calls (e.g. the karmic
   *  death-reflection) that cheap bulk models do poorly. */
  readonly leadModels?: ReadonlyArray<string>;
  /** Soft cap — passed to OpenAI as max_tokens. */
  readonly maxTokens?: number;
  /** 0..2; default 0.7. */
  readonly temperature?: number;
  /** RFC-0031: an image URL to include as a multimodal part alongside `user`.
   *  When set, the route LEADS with the vision model so the call can actually
   *  see it. The picture is fed as-is — no extra instruction. */
  readonly imageUrl?: string;
}

/** A parsed JSON response from a chat completion. */
export interface ChatJsonResponse<T> {
  readonly value: T;
  /** Token-usage breakdown if returned by the API. */
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  /** Raw assistant text — useful for logging or debugging. */
  readonly raw: string;
}

const clientCache = new Map<string, OpenAI>();
function getClient(baseURL?: string, apiKey?: string): OpenAI {
  const cacheKey = baseURL ?? "openai";
  let client = clientCache.get(cacheKey);
  if (client === undefined) {
    client =
      baseURL !== undefined
        ? new OpenAI({ baseURL, apiKey })
        : new OpenAI(); // reads OPENAI_API_KEY from env
    clientCache.set(cacheKey, client);
  }
  return client;
}

// Routed-call bookkeeping: announce the route head once (not per
// cascade — that would spam every facet call) and every fallthrough.
let announcedRoute: string | null = null;

/**
 * Send one chat completion expecting a JSON object back. Parses the
 * response and returns the typed result. Throws on JSON parse errors,
 * model errors, or empty responses — caller decides retry strategy.
 */
export async function chatJson<T>(req: ChatJsonRequest): Promise<ChatJsonResponse<T>> {
  // Bulk-tier routing (PEPPERS_ROUTER env; "off" by default → single
  // OpenAI candidate, byte-identical to pre-router behaviour). The
  // candidate chain ends with the OpenAI default, so routing failures
  // degrade to today's path rather than killing the cascade.
  const candidates = await resolveRoute(
    "bulk",
    req.model ?? DEFAULT_MODEL,
    req.imageUrl ? [VISION_MODEL, ...(req.leadModels ?? [])] : (req.leadModels ?? []),
  );
  // A multimodal user turn: the prompt text plus the image part. The image is
  // included as-is (no framing) so the model voices what it actually sees.
  const userContent: unknown = req.imageUrl
    ? [
        { type: "text", text: req.user },
        { type: "image_url", image_url: { url: req.imageUrl } },
      ]
    : req.user;
  let resp: OpenAI.Chat.Completions.ChatCompletion | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (routerPolicy() !== "off" && announcedRoute !== c.model) {
      announcedRoute = c.model;
      console.info(`[peppers-router] bulk → ${c.source} ${c.model}`);
    }
    try {
      resp = await getClient(c.baseURL, c.apiKey).chat.completions.create({
        model: c.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: userContent as string },
        ],
        response_format: { type: "json_object" },
        temperature: req.temperature ?? 0.7,
        max_completion_tokens: req.maxTokens,
      });
      const candidateContent = resp.choices[0]?.message?.content;
      if (!candidateContent) {
        throw Object.assign(new Error("empty response"), { status: 502 });
      }
      // Validate INSIDE the loop so a model that ignores json_object
      // mode falls through to the next candidate instead of killing
      // the cascade. (Truncation via maxTokens is exempt — that's the
      // Fuel mechanic, not a model failure; the caller's safety net
      // handles it.)
      if (resp.choices[0]?.finish_reason !== "length") {
        try {
          JSON.parse(candidateContent);
        } catch {
          throw Object.assign(new Error("non-JSON reply"), { status: 502 });
        }
      }
      break;
    } catch (err) {
      lastErr = err;
      resp = null;
      const isLast = i === candidates.length - 1;
      if (isLast || !isFallthroughError(err)) throw err;
      console.warn(
        `[peppers-router] ${c.model} failed (${err instanceof Error ? err.message.slice(0, 80) : err}) — falling through to ${candidates[i + 1]!.model}`,
      );
    }
  }
  if (resp === null) throw lastErr ?? new Error("no candidates produced a response");

  const choice = resp.choices[0];
  const content = choice?.message?.content ?? "";
  if (!content) {
    throw new Error(
      `LLM returned empty response (finish_reason=${choice?.finish_reason ?? "unknown"})`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `LLM returned non-JSON content: ${(err as Error).message}\n--- raw ---\n${content}`,
    );
  }

  return {
    value: parsed as T,
    usage:
      resp.usage === undefined || resp.usage === null
        ? null
        : {
            prompt: resp.usage.prompt_tokens,
            completion: resp.usage.completion_tokens,
            total: resp.usage.total_tokens,
          },
    raw: content,
  };
}

/** One discoverable tool, in the shape OpenAI tool-calling expects. */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ChatToolsRequest {
  readonly system: string;
  readonly user: string;
  readonly tools: ReadonlyArray<ToolSchema>;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** When true, the model MUST call a tool (not just emit text). Default true. */
  readonly forceToolCall?: boolean;
}

export interface ChatToolsResponse {
  /** The tool the LLM chose to call, parsed from OpenAI's tool_calls. */
  readonly toolCall: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  readonly raw: string;
}

/**
 * Stateful variant of {@link ChatToolsRequest} that drives OpenAI's
 * Responses API. Each ghost keeps a server-side conversation thread
 * keyed by `previousResponseId`; subsequent calls only send the new
 * turn (the "delta") and the model has native memory of everything
 * said before. Step 5 of the v2 surgical roadmap.
 *
 * The first call for a ghost passes `instructions` (system prompt
 * with identity baked in) and omits `previousResponseId`. Every later
 * call passes `previousResponseId` — `instructions` are remembered by
 * the server-side thread and should NOT be re-sent.
 *
 * Tools ARE re-sent every call. The Responses API doesn't persist a
 * tool registry on the thread, and the world's tool menu can change
 * mid-game (mini-games register / deregister).
 */
export interface StatefulChatToolsRequest {
  /** System prompt for the FIRST call only. Server-side thread
   *  carries it forward — must be undefined when previousResponseId
   *  is set, or you'll either pay for it twice or silently override
   *  the running thread's identity. */
  readonly instructions?: string;
  /** The new user-turn text (what's new this cascade). */
  readonly input: string;
  /** Server-side conversation id from the previous response, or
   *  undefined for the first call. */
  readonly previousResponseId?: string;
  readonly tools: ReadonlyArray<ToolSchema>;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** When true, the model MUST call a tool. Default true. */
  readonly forceToolCall?: boolean;
}

export interface StatefulChatToolsResponse {
  /** The tool the LLM chose to call. */
  readonly toolCall: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
  /** Server-side id of the response we just received. Pass as
   *  previousResponseId on the next call to continue the thread. */
  readonly responseId: string;
  /** The Responses API requires the thread that ended with a
   *  function_call to receive a function_call_output before the next
   *  user turn. The caller stores this `call_id` and passes it as
   *  `pendingFunctionCallOutput.call_id` on the next call so the
   *  thread closes out cleanly. Without this, cascade ≥ 2 throws or
   *  the model responds with text instead of a tool call. */
  readonly pendingCallId: string;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  readonly raw: string;
}

/**
 * Stateful tool-call against the Responses API. The first call sets
 * the system instructions; subsequent calls reference the prior
 * response_id and the server reconstructs the full thread from
 * conversation state.
 *
 * If the server rejects a stale or unknown previous_response_id, the
 * caller is expected to drop the cached id and retry with the
 * instructions re-supplied. This function does NOT do that
 * transparently — the caller owns the per-ghost cache and decides
 * when to invalidate it.
 */
export async function chatToolsStateful(
  req: StatefulChatToolsRequest,
): Promise<StatefulChatToolsResponse> {
  if (req.tools.length === 0) {
    throw new Error("chatToolsStateful called with no tools — nothing for the LLM to pick");
  }
  const client = getClient();
  // Responses-API tool shape is FLAT: { type, name, description, parameters }.
  // (Chat-Completions wraps name/description/parameters under `function:`.)
  const tools = req.tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
  }));
  // Per the SDK shape, the client.responses.create call accepts:
  //   { model, input, instructions?, previous_response_id?, tools,
  //     tool_choice, max_output_tokens?, temperature? }
  // We cast through `as never` for the call to avoid coupling tightly
  // to the SDK's evolving type names — the runtime contract is what
  // matters and is documented above.
  const callArgs: Record<string, unknown> = {
    model: req.model ?? DEFAULT_MODEL,
    input: req.input,
    tools,
    tool_choice: (req.forceToolCall ?? true) ? "required" : "auto",
    temperature: req.temperature ?? 0.7,
  };
  if (req.previousResponseId !== undefined) {
    callArgs["previous_response_id"] = req.previousResponseId;
  } else if (req.instructions !== undefined) {
    callArgs["instructions"] = req.instructions;
  }
  if (req.maxTokens !== undefined) {
    callArgs["max_output_tokens"] = req.maxTokens;
  }
  const resp = (await (client.responses.create as (a: unknown) => Promise<unknown>)(
    callArgs,
  )) as {
    id: string;
    output?: ReadonlyArray<{
      type?: string;
      name?: string;
      arguments?: string;
      call_id?: string;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };

  // Find the first function-call item in the output array. Responses
  // can interleave message + function_call items; we only care about
  // the chosen tool (force=required guarantees one).
  const fnCall = (resp.output ?? []).find((o) => o.type === "function_call");
  if (!fnCall || typeof fnCall.name !== "string" || !fnCall.call_id) {
    throw new Error(
      `Responses API returned no function_call (response_id=${resp.id}); output=${JSON.stringify(resp.output).slice(0, 300)}`,
    );
  }
  let args: Record<string, unknown> = {};
  if (fnCall.arguments && fnCall.arguments.length > 0) {
    try {
      args = JSON.parse(fnCall.arguments) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `Responses tool_call arguments were not valid JSON: ${(err as Error).message}\n--- raw ---\n${fnCall.arguments}`,
      );
    }
  }
  const usageRaw = resp.usage;
  return {
    toolCall: { name: fnCall.name, arguments: args },
    responseId: resp.id,
    pendingCallId: fnCall.call_id,
    usage:
      usageRaw === undefined || usageRaw === null
        ? null
        : {
            prompt: usageRaw.input_tokens ?? 0,
            completion: usageRaw.output_tokens ?? 0,
            total: usageRaw.total_tokens ?? 0,
          },
    raw: JSON.stringify({ name: fnCall.name, arguments: fnCall.arguments ?? "" }),
  };
}

/**
 * Tool-loop variant of {@link chatToolsStateful} that handles
 * intermediate "recall" tool calls inside the substrate, returning
 * only when the model picks a non-recall (world-action) tool. Used
 * by Step 6 to let the Surface adaptively PULL memory mid-decision.
 *
 * Loop body:
 *   - Send the next input (user text on round 1; function_call_output
 *     on round N).
 *   - Inspect the returned function_call.
 *   - If its name is in `recallToolNames`, the runner is invoked with
 *     (name, args) and its returned string is sent back as a
 *     function_call_output. Loop continues, with previous_response_id
 *     pinned to the just-received response.
 *   - Otherwise (world-action tool), return.
 *
 * `maxRecallRounds` is a guard against a model that loops on recall
 * without ever acting (typically 3-5 is plenty for a single cascade).
 * Hitting the cap throws — the run-loop will surface the failure.
 */
export interface StatefulChatToolsLoopRequest {
  readonly instructions?: string;
  readonly input: string;
  readonly previousResponseId?: string;
  readonly tools: ReadonlyArray<ToolSchema>;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly forceToolCall?: boolean;
  /** Tool names that should be handled inside the loop as recalls,
   *  not returned to the caller. */
  readonly recallToolNames: ReadonlySet<string>;
  /** Invoked when the model picks a recall tool. Returned string is
   *  sent back as the tool's function_call_output. */
  readonly runRecall: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
  /** Safety cap on recall rounds inside one cascade. Default 6. */
  readonly maxRecallRounds?: number;
  /** Closes out a function_call left unanswered by the previous
   *  cascade (the world action the caller returned, executed, and
   *  now has an outcome for). Prepended to `input` on the first
   *  round so the thread state is consistent. Without this, the
   *  Responses API rejects the continuation. */
  readonly pendingFunctionCallOutput?: {
    readonly callId: string;
    readonly output: string;
  };
  /** User-role messages to inject into the thread BEFORE the main
   *  `input`. Used to feed inbound peer utterances into the
   *  Surface's stateful thread so the conversation appears in its
   *  conversation history (the substrate fix to "the Surface isn't
   *  seeing the conversation"). Each entry becomes a separate
   *  user-role item; ordering is preserved. */
  readonly priorUserMessages?: ReadonlyArray<string>;
  /** RFC-0031: an image URL to attach to the main user turn as a multimodal
   *  part (a painting the ghost is looking at). When set, the call routes to
   *  the vision model so the Surface can speak from what it actually sees. */
  readonly imageUrl?: string;
}

export async function chatToolsStatefulLoop(
  req: StatefulChatToolsLoopRequest,
): Promise<StatefulChatToolsResponse> {
  if (req.tools.length === 0) {
    throw new Error("chatToolsStatefulLoop called with no tools");
  }
  const client = getClient();
  const tools = req.tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
  }));
  const baseArgs: Record<string, unknown> = {
    model: req.imageUrl ? VISION_MODEL : (req.model ?? DEFAULT_MODEL),
    tools,
    tool_choice: (req.forceToolCall ?? true) ? "required" : "auto",
    temperature: req.temperature ?? 0.7,
  };
  if (req.maxTokens !== undefined) baseArgs["max_output_tokens"] = req.maxTokens;
  // The main user turn, optionally carrying a painting as a multimodal part.
  const mainUserContent: unknown = req.imageUrl
    ? [
        { type: "input_text", text: req.input },
        { type: "input_image", image_url: req.imageUrl },
      ]
    : req.input;

  const maxRounds = req.maxRecallRounds ?? 6;
  let prevId: string | undefined = req.previousResponseId;
  // First-round input. Assemble in this order so the thread state is
  // consistent and the conversation history reads correctly:
  //   1. function_call_output closing out the prior cascade's
  //      unanswered tool call (required by the Responses API).
  //   2. Any inbound peer messages — these become user-role items so
  //      the model's thread shows the actual back-and-forth of the
  //      conversation (the fix for "the Surface isn't seeing the
  //      conversation"). On a brand-new thread, these are the first
  //      user messages and look like a chat.
  //   3. The main substrate prompt that asks the model to act this
  //      turn.
  // If neither (1) nor (2) is set, we send `req.input` as a bare
  // string — matching the old behavior so unchanged callers don't
  // change semantics.
  let nextInput: unknown = req.imageUrl
    ? [{ role: "user", content: mainUserContent }]
    : req.input;
  const hasPrefix =
    req.pendingFunctionCallOutput !== undefined ||
    (req.priorUserMessages !== undefined && req.priorUserMessages.length > 0);
  if (hasPrefix) {
    const items: unknown[] = [];
    if (req.pendingFunctionCallOutput !== undefined) {
      items.push({
        type: "function_call_output",
        call_id: req.pendingFunctionCallOutput.callId,
        output: req.pendingFunctionCallOutput.output,
      });
    }
    for (const msg of req.priorUserMessages ?? []) {
      items.push({ role: "user", content: msg });
    }
    items.push({ role: "user", content: mainUserContent });
    nextInput = items;
  }
  let usageSum = { prompt: 0, completion: 0, total: 0 };

  for (let round = 0; round < maxRounds + 1; round++) {
    const callArgs: Record<string, unknown> = { ...baseArgs, input: nextInput };
    if (prevId !== undefined) {
      callArgs["previous_response_id"] = prevId;
    }
    // Always re-send instructions (identity anchor), not only on the first
    // turn. OpenRouter does NOT reliably maintain Responses-API thread state
    // (previous_response_id) for non-OpenAI models, so relying on the thread
    // to carry "You are <Name>" loses identity after turn 1 → the model
    // invents names. Instructions apply to the current turn alongside
    // previous_response_id, so this is safe and idempotent.
    if (req.instructions !== undefined) {
      callArgs["instructions"] = req.instructions;
    }
    const resp = (await (client.responses.create as (a: unknown) => Promise<unknown>)(
      callArgs,
    )) as {
      id: string;
      output?: ReadonlyArray<{
        type?: string;
        name?: string;
        arguments?: string;
        call_id?: string;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    if (resp.usage) {
      usageSum = {
        prompt: usageSum.prompt + (resp.usage.input_tokens ?? 0),
        completion: usageSum.completion + (resp.usage.output_tokens ?? 0),
        total: usageSum.total + (resp.usage.total_tokens ?? 0),
      };
    }
    const fnCall = (resp.output ?? []).find((o) => o.type === "function_call");
    if (!fnCall || typeof fnCall.name !== "string" || !fnCall.call_id) {
      throw new Error(
        `Responses tool-loop returned no function_call (response_id=${resp.id}); output=${JSON.stringify(resp.output).slice(0, 300)}`,
      );
    }
    let args: Record<string, unknown> = {};
    if (fnCall.arguments && fnCall.arguments.length > 0) {
      try {
        args = JSON.parse(fnCall.arguments) as Record<string, unknown>;
      } catch (err) {
        throw new Error(
          `Responses tool_call arguments were not valid JSON: ${(err as Error).message}\n--- raw ---\n${fnCall.arguments}`,
        );
      }
    }
    prevId = resp.id;
    if (!req.recallToolNames.has(fnCall.name)) {
      // World action — exit the loop. The caller MUST store
      // pendingCallId and pass it as pendingFunctionCallOutput on
      // the next cascade so the thread continues cleanly.
      return {
        toolCall: { name: fnCall.name, arguments: args },
        responseId: resp.id,
        pendingCallId: fnCall.call_id,
        usage: usageSum.total > 0 ? usageSum : null,
        raw: JSON.stringify({ name: fnCall.name, arguments: fnCall.arguments ?? "" }),
      };
    }
    // Recall: execute, then resubmit as function_call_output.
    let output: string;
    try {
      output = await req.runRecall(fnCall.name, args);
    } catch (err) {
      output = `(recall errored: ${(err as Error).message})`;
    }
    nextInput = [
      {
        type: "function_call_output",
        call_id: fnCall.call_id,
        output,
      },
    ];
  }
  throw new Error(
    `Responses tool-loop exceeded ${maxRounds} recall rounds without a world action`,
  );
}

/**
 * Detect "previous_response_id stale / unknown" errors so the caller
 * can drop its cached id and retry with fresh instructions. The
 * OpenAI SDK throws errors with status codes; this matches the most
 * common shapes we've seen. Conservative — only the response-id-not-
 * found case; other errors propagate.
 */
export function isStaleResponseIdError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const anyErr = err as { status?: number; code?: string; message?: string };
  const msg = anyErr.message?.toLowerCase() ?? "";
  if (anyErr.status === 404 && msg.includes("response")) return true;
  if (anyErr.code === "response_not_found") return true;
  if (msg.includes("previous_response_id") && msg.includes("not found")) return true;
  return false;
}

/**
 * Send one chat completion with OpenAI tool-calling — the model is
 * given real tool schemas and picks one to invoke. This is genuine
 * tool discovery: the menu comes from the MCP server, not from a
 * hardcoded prompt enumeration.
 */
export async function chatTools(req: ChatToolsRequest): Promise<ChatToolsResponse> {
  if (req.tools.length === 0) {
    throw new Error("chatTools called with no tools — nothing for the LLM to pick");
  }
  const client = getClient();
  const resp = await client.chat.completions.create({
    model: req.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    tools: req.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    })),
    tool_choice: (req.forceToolCall ?? true) ? "required" : "auto",
    temperature: req.temperature ?? 0.7,
    max_completion_tokens: req.maxTokens,
  });

  const choice = resp.choices[0];
  const toolCalls = choice?.message?.tool_calls ?? [];
  const first = toolCalls[0];
  if (!first || first.type !== "function") {
    const text = choice?.message?.content ?? "";
    throw new Error(
      `LLM did not call a tool (finish_reason=${choice?.finish_reason ?? "unknown"}); content=${JSON.stringify(text).slice(0, 200)}`,
    );
  }
  let args: Record<string, unknown> = {};
  if (first.function.arguments && first.function.arguments.length > 0) {
    try {
      args = JSON.parse(first.function.arguments) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `LLM tool_call arguments were not valid JSON: ${(err as Error).message}\n--- raw ---\n${first.function.arguments}`,
      );
    }
  }

  return {
    toolCall: { name: first.function.name, arguments: args },
    usage:
      resp.usage === undefined || resp.usage === null
        ? null
        : {
            prompt: resp.usage.prompt_tokens,
            completion: resp.usage.completion_tokens,
            total: resp.usage.total_tokens,
          },
    raw: JSON.stringify({ name: first.function.name, arguments: first.function.arguments }),
  };
}
