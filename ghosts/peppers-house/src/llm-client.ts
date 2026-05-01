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
    max_tokens: req.maxTokens,
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
