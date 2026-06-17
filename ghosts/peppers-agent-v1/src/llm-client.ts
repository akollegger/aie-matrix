/**
 * Thin OpenAI client wrapper. Centralizes the model selection, the
 * JSON-output prompt pattern, and basic error normalization so
 * `reason-id` and `reason-surface` can stay small.
 *
 * The default model is set per project memory: `gpt-5.4-nano-2026-03-17`.
 * Override per call via the `model` arg if you need a different one.
 */

import OpenAI from "openai";

/** Project default — see memory `feedback_model_authority.md`. */
export const DEFAULT_MODEL = "gpt-5.4-nano-2026-03-17";

/** A single LLM exchange. */
export interface ChatJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly model?: string;
  /** Soft cap — passed to OpenAI as max_tokens. */
  readonly maxTokens?: number;
  /** 0..2; default 0.7. */
  readonly temperature?: number;
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

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (cachedClient === null) {
    cachedClient = new OpenAI(); // reads OPENAI_API_KEY from env
  }
  return cachedClient;
}

/**
 * Send one chat completion expecting a JSON object back. Parses the
 * response and returns the typed result. Throws on JSON parse errors,
 * model errors, or empty responses — caller decides retry strategy.
 */
export async function chatJson<T>(req: ChatJsonRequest): Promise<ChatJsonResponse<T>> {
  const client = getClient();
  const resp = await client.chat.completions.create({
    model: req.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_object" },
    temperature: req.temperature ?? 0.7,
    max_completion_tokens: req.maxTokens,
  });

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
