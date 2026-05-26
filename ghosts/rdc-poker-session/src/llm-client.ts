/**
 * Tiny OpenAI wrapper for the poker brain.
 *
 * Mirrors `peppers-agent`'s llm-client but kept local because peppers
 * doesn't export `chatJson` (only `DEFAULT_MODEL`). Keeping rdc-agent's
 * boundary clean — peppers-agent is a library dependency, not a deep
 * import surface.
 */

import OpenAI from "openai";

import { DEFAULT_MODEL as PEPPERS_DEFAULT_MODEL } from "@aie-matrix/ghost-peppers-agent";

/** Project default — defers to peppers' default to stay aligned. */
export const DEFAULT_MODEL = PEPPERS_DEFAULT_MODEL;

export interface ChatJsonRequest {
  readonly system: string;
  readonly user: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface ChatJsonResponse<T> {
  readonly value: T;
  readonly usage: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  } | null;
  readonly raw: string;
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (cachedClient === null) {
    cachedClient = new OpenAI();
  }
  return cachedClient;
}

export async function chatJson<T>(
  req: ChatJsonRequest,
): Promise<ChatJsonResponse<T>> {
  const client = getClient();
  const resp = await client.chat.completions.create({
    model: req.model ?? DEFAULT_MODEL,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: { type: "json_object" },
    temperature: req.temperature ?? 0.7,
    // Newer OpenAI models (gpt-5.4-nano, gpt-4o, etc.) reject
    // `max_tokens` and require `max_completion_tokens` instead.
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
