/**
 * Local model router for the peppers stack.
 *
 * Every chat call in peppers goes through one of two thin clients
 * (`peppers-agent-v2/src/llm-client.ts`, `peppers-sleep/src/llm/nano.ts`).
 * This package gives those clients a single decision function:
 *
 *   resolveRoute(tier, fallbackModel) → ordered RouteCandidate[]
 *
 * The consumer tries candidates in order, falling through on transport
 * errors (429 / 5xx / empty response). The LAST candidate is always the
 * original OpenAI default, so a fully-down OpenRouter degrades to
 * exactly today's behaviour.
 *
 * Policy (PEPPERS_ROUTER env):
 *   free-first — (default since 2026-06-12, per project direction:
 *                OpenRouter is the primary provider) eligible
 *                OpenRouter `:free` models, then cheapest eligible
 *                paid, then the OpenAI default.
 *   cheapest   — cheapest eligible OpenRouter model (free models price at
 *                0 and so sort first), then the OpenAI default.
 *   off        — single candidate: the OpenAI default. Escape hatch /
 *                pre-router behaviour.
 *
 * Tiers:
 *   bulk    — high-volume cascade calls (facets, impulse, convergence,
 *             synthesis, consolidation, judges). Routed per policy.
 *   quality — abstraction-grade calls (skill distillation). NOT routed
 *             unless PEPPERS_ROUTER_QUALITY_MODEL pins a model — cheap
 *             models measurably fail schema-following here (see
 *             OVERNIGHT-LOG 2026-06-12, schema-echo defect).
 *
 * Eligibility for our stack is mechanical, not vibes: the model must
 * advertise `response_format` or `structured_outputs` support (every
 * peppers call parses strict JSON) and ≥ 16K context. Free variants are
 * rate-limited upstream (~50–1000 req/day) — fine for dev smoke tests,
 * NOT for lab runs; that's why fall-through is built in rather than
 * bolted on.
 *
 * Out of scope, deliberately:
 *   - The `@openai/agents` action stage (Responses-API server-side
 *     thread state) stays on OpenAI.
 *   - Embeddings stay on OpenAI: every stored intent_embedding is
 *     text-embedding-3-small/1536-d; changing embedder invalidates the
 *     whole similarity space.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type RouterPolicy = "off" | "free-first" | "cheapest";
export type RouteTier = "bulk" | "quality";

export interface RouteCandidate {
  /** Model id to send (OpenRouter ids include the vendor prefix). */
  readonly model: string;
  /** undefined → the consumer's default client (OpenAI). */
  readonly baseURL?: string;
  /** undefined → the consumer's default key (OPENAI_API_KEY). */
  readonly apiKey?: string;
  /** Provenance, for logs: "openrouter:free" | "openrouter:paid" | "openai" */
  readonly source: string;
}

export interface CatalogModel {
  readonly id: string;
  readonly contextLength: number;
  readonly promptPrice: number;
  readonly completionPrice: number;
  readonly supportedParameters: ReadonlyArray<string>;
  /** e.g. "text->text", "text+image->text", "text->audio" (Lyria!) */
  readonly modality: string;
}

export function routerPolicy(): RouterPolicy {
  const raw = (process.env.PEPPERS_ROUTER ?? "free-first").toLowerCase();
  if (raw === "free-first" || raw === "cheapest" || raw === "off") {
    return raw as RouterPolicy;
  }
  return "free-first";
}

// ---------------------------------------------------------------------------
// Catalog: live /models scan, cached in-memory and on disk (1h TTL) so a
// lab run does one fetch, not one per ghost per cascade.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(here, "..", ".local", "openrouter-models.json");

let memoryCache: { at: number; models: CatalogModel[] } | null = null;

export async function fetchCatalog(): Promise<CatalogModel[]> {
  if (memoryCache !== null && Date.now() - memoryCache.at < CACHE_TTL_MS) {
    return memoryCache.models;
  }
  try {
    const disk = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as {
      at: number;
      models: CatalogModel[];
    };
    if (Date.now() - disk.at < CACHE_TTL_MS) {
      memoryCache = disk;
      return disk.models;
    }
  } catch {
    /* no disk cache — fetch */
  }

  const key = process.env.OPEN_ROUTER_API_KEY;
  if (!key) throw new Error("OPEN_ROUTER_API_KEY not set");
  const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`);
  const body = (await res.json()) as {
    data: Array<{
      id: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      supported_parameters?: string[];
      architecture?: { modality?: string };
    }>;
  };
  const models: CatalogModel[] = body.data.map((m) => ({
    id: m.id,
    contextLength: m.context_length ?? 0,
    promptPrice: Number(m.pricing?.prompt ?? Number.POSITIVE_INFINITY),
    completionPrice: Number(m.pricing?.completion ?? Number.POSITIVE_INFINITY),
    supportedParameters: m.supported_parameters ?? [],
    modality: m.architecture?.modality ?? "",
  }));
  memoryCache = { at: Date.now(), models };
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(memoryCache));
  } catch {
    /* disk cache is best-effort */
  }
  return models;
}

// ---------------------------------------------------------------------------
// Eligibility + ranking
// ---------------------------------------------------------------------------

const MIN_CONTEXT = 16_000;

export function isEligible(m: CatalogModel): boolean {
  const p = m.supportedParameters;
  const json = p.includes("response_format") || p.includes("structured_outputs");
  // Modality gate: catalog entries include music/image/audio models with
  // chat-shaped metadata (live finding: google/lyria-3-* 400s on chat).
  const textToText = m.modality.endsWith("->text") && m.modality.startsWith("text");
  // Price sanity: openrouter/auto prices at -1 (live finding: it sorted
  // to the head of "cheapest paid" with a blended price of -$1M/MTok).
  const sanePricing = m.promptPrice >= 0 && m.completionPrice >= 0;
  return json && textToText && sanePricing && m.contextLength >= MIN_CONTEXT;
}

export function isFree(m: CatalogModel): boolean {
  return m.id.endsWith(":free") || (m.promptPrice === 0 && m.completionPrice === 0);
}

/** Blended $/MTok at a peppers-typical 3:1 prompt:completion ratio. */
export function blendedPrice(m: CatalogModel): number {
  return (3 * m.promptPrice + m.completionPrice) * 1_000_000 / 4;
}

export function rankFree(models: ReadonlyArray<CatalogModel>): CatalogModel[] {
  return models
    .filter((m) => isEligible(m) && isFree(m))
    .sort((a, b) => b.contextLength - a.contextLength);
}

export function rankCheapestPaid(models: ReadonlyArray<CatalogModel>): CatalogModel[] {
  return models
    .filter((m) => isEligible(m) && !isFree(m) && Number.isFinite(blendedPrice(m)))
    .sort((a, b) => blendedPrice(a) - blendedPrice(b));
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

const FREE_CANDIDATES = 2;
const PAID_CANDIDATES = 2;

/**
 * Ordered candidate chain for one call. Never throws on catalog
 * trouble — degrades to [openai default] so a cascade can't die on a
 * routing failure.
 */
export async function resolveRoute(
  tier: RouteTier,
  fallbackModel: string,
  /**
   * Per-call capable lead models (OpenRouter slugs), prepended ahead of
   * the env `PEPPERS_ROUTER_PREFER` list and the free/paid ranking. Used
   * by the agentic Id action stage to lead on a capable model (which must
   * converge within the turn budget) while bulk calls and fork-join
   * workers lean free. Empty for the free-leaning bulk path.
   */
  leadModels: ReadonlyArray<string> = [],
): Promise<RouteCandidate[]> {
  const openaiDefault: RouteCandidate = { model: fallbackModel, source: "openai" };
  const policy = routerPolicy();
  if (policy === "off") return [openaiDefault];

  if (tier === "quality") {
    const pinned = process.env.PEPPERS_ROUTER_QUALITY_MODEL;
    if (pinned === undefined || pinned === "") return [openaiDefault];
    return [
      {
        model: pinned,
        baseURL: OPENROUTER_BASE_URL,
        apiKey: process.env.OPEN_ROUTER_API_KEY,
        source: "openrouter:pinned",
      },
      openaiDefault,
    ];
  }

  let catalog: CatalogModel[];
  try {
    catalog = await fetchCatalog();
  } catch {
    return [openaiDefault];
  }
  const key = process.env.OPEN_ROUTER_API_KEY;
  if (!key) return [openaiDefault];

  const or = (m: CatalogModel, source: string): RouteCandidate => ({
    model: m.id,
    baseURL: OPENROUTER_BASE_URL,
    apiKey: key,
    source,
  });

  const chain: RouteCandidate[] = [];
  // Per-call capable leads (e.g. the Id action stage's Haiku) come first,
  // ahead of the env prefer list and the free ranking.
  for (const id of leadModels) {
    const m = catalog.find((c) => c.id === id);
    if (m !== undefined && isEligible(m)) {
      chain.push(or(m, isFree(m) ? "openrouter:free" : "openrouter:paid"));
    }
  }
  // PEPPERS_ROUTER_PREFER: comma-separated model ids to lead the chain
  // (e.g. the measured-fastest conforming models from `pnpm run rank`).
  // Catalog ranking alone can't see speed — owl-alpha leads on context
  // but probes at 15 tok/s; nemotron-nano-9b probes at 832 tok/s.
  const prefer = (process.env.PEPPERS_ROUTER_PREFER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const id of prefer) {
    const m = catalog.find((c) => c.id === id);
    if (m !== undefined && isEligible(m)) {
      chain.push(or(m, isFree(m) ? "openrouter:free" : "openrouter:paid"));
    }
  }
  if (policy === "free-first") {
    for (const m of rankFree(catalog).slice(0, FREE_CANDIDATES)) {
      chain.push(or(m, "openrouter:free"));
    }
    for (const m of rankCheapestPaid(catalog).slice(0, PAID_CANDIDATES)) {
      chain.push(or(m, "openrouter:paid"));
    }
  } else {
    // cheapest — free models price at 0 and sort first naturally.
    const all = [...rankFree(catalog), ...rankCheapestPaid(catalog)];
    for (const m of all.slice(0, FREE_CANDIDATES + PAID_CANDIDATES)) {
      chain.push(or(m, isFree(m) ? "openrouter:free" : "openrouter:paid"));
    }
  }
  chain.push(openaiDefault);
  // De-dup (prefer-list entries may also appear in the ranked slice).
  const seen = new Set<string>();
  return chain.filter((c) => {
    const k = `${c.baseURL ?? "openai"}|${c.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * True when `err` is worth falling through to the next candidate:
 * rate limits, upstream provider failures, transport errors, or an
 * empty/non-JSON reply (cheap models' most common failure shape).
 * Schema/validation 400s also fall through — a different model may
 * support the parameter set.
 */
export function isFallthroughError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return true;
  const e = err as { status?: number; message?: string };
  if (typeof e.status === "number") {
    return e.status === 429 || e.status >= 500 || e.status === 400 || e.status === 404;
  }
  return true;
}
