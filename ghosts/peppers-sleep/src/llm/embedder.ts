/**
 * OpenAI embeddings client for the sleep pipeline.
 *
 * Hard-wired to OpenAI even if the main agent layer ever swaps to
 * Anthropic for cognition models — the embedding step is a separate
 * concern with its own provider. This keeps the sleep package's
 * dependency on OpenAI from coupling to whatever the cognition
 * agents are using.
 *
 * Defaults to `text-embedding-3-small` at its native 1536 dims —
 * matches the dim already on `Message.embedding` from agent-memory.
 * Do NOT override `dimensions` for AuraDB compatibility (Aura rejects
 * non-default dim values).
 */

import OpenAI from "openai";

const DEFAULT_MODEL = "text-embedding-3-small";

export interface IntentEmbedderOptions {
  readonly apiKey?: string;
  readonly model?: string;
}

export class IntentEmbedder {
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: IntentEmbedderOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "IntentEmbedder: OPENAI_API_KEY not set (and no apiKey override given). " +
          "The sleep pipeline's embedding step is hard-wired to OpenAI.",
      );
    }
    this.client = new OpenAI({ apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  /**
   * Embed a batch of texts. Chunked + retried + guarded: under concurrent
   * sleep load the embeddings endpoint (OpenRouter in staging) intermittently
   * returns a 200 whose body has no `data` array; the old `response.data.map`
   * turned that into a `TypeError` that aborted the whole blackout. We now
   * retry the chunk a few times and, if the shape is still wrong, throw a
   * DESCRIPTIVE error (so the cause is visible, not a cryptic `.map` crash).
   */
  async embedBatch(texts: ReadonlyArray<string>): Promise<number[][]> {
    if (texts.length === 0) return [];
    const CHUNK = 64;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += CHUNK) {
      out.push(...(await this.embedChunk(texts.slice(i, i + CHUNK))));
    }
    return out;
  }

  private async embedChunk(chunk: ReadonlyArray<string>): Promise<number[][]> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: chunk as string[],
        });
        const data = (response as { data?: unknown }).data;
        if (Array.isArray(data) && data.length === chunk.length) {
          return data.map((d) => (d as { embedding: number[] }).embedding);
        }
        lastErr = new Error(
          `embeddings response shape wrong: expected ${chunk.length} vectors, got ` +
            `${Array.isArray(data) ? `${data.length}` : typeof data} — ` +
            `${JSON.stringify(response).slice(0, 200)}`,
        );
      } catch (e) {
        lastErr = e;
      }
      // Transient (rate-limit / provider hiccup under concurrent sleeps) —
      // brief backoff then retry the same chunk.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
