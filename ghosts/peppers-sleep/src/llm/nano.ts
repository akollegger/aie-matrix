/**
 * Nano-tier LLM client for the sleep pipeline.
 *
 * Used by step 6 (per-cluster consolidation): a small, cheap model
 * that preserves discrete facts from a cluster into a structured
 * bullet list. The task is content-preservation, not abstraction,
 * so a nano model is fit-for-purpose.
 *
 * Separate from `IntentEmbedder` (which is hard-wired to OpenAI) —
 * the nano model is a thin abstraction so the Python port can swap
 * in Anthropic or another provider behind the same interface.
 *
 * Default model is `gpt-5.4-nano-2026-03-17`. Override per-call when
 * a stronger model is justified (e.g., contradiction detection).
 */

import OpenAI from "openai";

import {
  isFallthroughError,
  resolveRoute,
  routerPolicy,
  type RouteTier,
} from "@aie-matrix/ghost-peppers-router";

const DEFAULT_MODEL = "gpt-5.4-nano-2026-03-17";

export interface NanoOptions {
  readonly apiKey?: string;
  readonly model?: string;
  /** Router tier (PEPPERS_ROUTER env). "bulk" (default) follows the
   *  policy; "quality" stays on the configured model unless
   *  PEPPERS_ROUTER_QUALITY_MODEL pins an OpenRouter id. Distillation
   *  passes "quality" — cheap models measurably fail schema-following
   *  there. */
  readonly tier?: RouteTier;
}

export interface NanoMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export class NanoClient {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly tier: RouteTier;
  private readonly routedClients = new Map<string, OpenAI>();
  private announcedRoute: string | null = null;

  constructor(opts: NanoOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "NanoClient: OPENAI_API_KEY not set (and no apiKey override given).",
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.tier = opts.tier ?? "bulk";
  }

  /**
   * Run one completion through the router's candidate chain. The chain
   * always ends on the constructor's OpenAI model, so PEPPERS_ROUTER=off
   * (default) and any routing failure both produce exactly the
   * pre-router behaviour.
   */
  private async routed<T>(
    call: (client: OpenAI, model: string) => Promise<T>,
    validate: (result: T) => boolean,
  ): Promise<T> {
    const candidates = await resolveRoute(this.tier, this.model);
    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      let client: OpenAI;
      if (c.baseURL === undefined) {
        client = this.client;
      } else {
        let cached = this.routedClients.get(c.baseURL);
        if (cached === undefined) {
          cached = new OpenAI({ baseURL: c.baseURL, apiKey: c.apiKey });
          this.routedClients.set(c.baseURL, cached);
        }
        client = cached;
      }
      if (routerPolicy() !== "off" && this.announcedRoute !== c.model) {
        this.announcedRoute = c.model;
        console.info(`[peppers-router] ${this.tier} → ${c.source} ${c.model}`);
      }
      try {
        const result = await call(client, c.model);
        if (!validate(result)) {
          throw Object.assign(new Error("response failed validation"), { status: 502 });
        }
        return result;
      } catch (err) {
        lastErr = err;
        const isLast = i === candidates.length - 1;
        if (isLast || !isFallthroughError(err)) throw err;
        console.warn(
          `[peppers-router] ${c.model} failed (${err instanceof Error ? err.message.slice(0, 80) : err}) — falling through to ${candidates[i + 1]!.model}`,
        );
      }
    }
    throw lastErr ?? new Error("no candidates produced a response");
  }

  async complete(
    messages: ReadonlyArray<NanoMessage>,
    opts: { readonly temperature?: number; readonly maxTokens?: number } = {},
  ): Promise<string> {
    const response = await this.routed(
      (client, model) =>
        client.chat.completions.create({
          model,
          messages: messages as NanoMessage[],
          temperature: opts.temperature ?? 0.2,
          ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
        }),
      (r) => typeof r.choices[0]?.message?.content === "string",
    );
    const content = response.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("NanoClient: empty completion");
    }
    return content.trim();
  }

  /** JSON-mode completion. The model is forced to emit valid JSON;
   *  parse + validate is the caller's job. */
  async completeJson(
    messages: ReadonlyArray<NanoMessage>,
    opts: { readonly temperature?: number } = {},
  ): Promise<string> {
    const response = await this.routed(
      (client, model) =>
        client.chat.completions.create({
          model,
          messages: messages as NanoMessage[],
          temperature: opts.temperature ?? 0.1,
          response_format: { type: "json_object" },
        }),
      (r) => {
        const c = r.choices[0]?.message?.content;
        if (typeof c !== "string") return false;
        try {
          JSON.parse(c);
          return true;
        } catch {
          return false;
        }
      },
    );
    const content = response.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("NanoClient: empty JSON completion");
    }
    return content;
  }

  /**
   * Schema-constrained completion (`response_format: json_schema`).
   * Used by Skill distillation with the vendored AIP procedure schema.
   * `strict` stays false: the AIP schema has optional properties,
   * which strict mode rejects; `quickShapeCheck` covers the gap.
   */
  async completeStructured(
    messages: ReadonlyArray<NanoMessage>,
    schema: { readonly name: string; readonly schema: Record<string, unknown> },
    opts: { readonly temperature?: number } = {},
  ): Promise<string> {
    const response = await this.routed(
      (client, model) =>
        client.chat.completions.create({
          model,
          messages: messages as NanoMessage[],
          temperature: opts.temperature ?? 0.2,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schema.name,
              schema: schema.schema,
              strict: false,
            },
          },
        }),
      (r) => {
        const c = r.choices[0]?.message?.content;
        if (typeof c !== "string") return false;
        try {
          JSON.parse(c);
          return true;
        } catch {
          return false;
        }
      },
    );
    const content = response.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("NanoClient: empty structured completion");
    }
    return content;
  }
}
