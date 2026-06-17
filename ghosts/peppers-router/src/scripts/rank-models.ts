/**
 * Rank OpenRouter models three ways for the peppers stack:
 *
 *   1. CHEAPEST  — blended $/MTok (3:1 prompt:completion), derived from
 *                  the live catalog. Free models first.
 *   2. FASTEST   — MEASURED: one timed JSON completion per candidate
 *                  (tokens/sec + time-to-response). Only the top-N
 *                  cheapest eligible models are probed, to bound cost.
 *   3. CONFORMANCE — the closest mechanical proxy for "smartest" we
 *                  can own: does the model return valid JSON under
 *                  response_format on a peppers-shaped prompt? "Smart"
 *                  beyond that is task-relative — the lab is the real
 *                  eval; leaderboard IQ is not queryable from the API.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-router run rank [-- --probes=N]
 *
 * Probes hit free models first (no cost) then cheapest paid (negligible
 * cost, ~30 tokens each).
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import {
  blendedPrice,
  fetchCatalog,
  isEligible,
  isFree,
  rankCheapestPaid,
  rankFree,
  OPENROUTER_BASE_URL,
  type CatalogModel,
} from "../index.js";

loadRootEnv();

const PROBE_PROMPT =
  'You are a terse classifier inside an agent pipeline. Output JSON only: {"action": "<one of look|take|consume|say|go>", "reason": "<one short sentence>"}. Stimulus: "Food in view at here". Current need: moderately hungry.';

interface ProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly tokensPerSec: number | null;
  readonly note: string;
}

async function probe(model: CatalogModel): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPEN_ROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: "user", content: PROBE_PROMPT }],
        response_format: { type: "json_object" },
        // Generous cap: reasoning models burn hidden tokens before any
        // content; 60 truncated mid-string and produced false FAILs
        // (live finding: nemotron emitted valid-but-cut-off JSON).
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      return { id: model.id, ok: false, ms, tokensPerSec: null, note: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { completion_tokens?: number };
      error?: { message?: string };
    };
    if (body.error) {
      return { id: model.id, ok: false, ms, tokensPerSec: null, note: body.error.message ?? "provider error" };
    }
    const content = body.choices?.[0]?.message?.content ?? "";
    let conforms = false;
    try {
      const parsed = JSON.parse(content) as { action?: unknown };
      conforms = typeof parsed.action === "string";
    } catch {
      conforms = false;
    }
    const completionTokens = body.usage?.completion_tokens ?? null;
    const tokensPerSec =
      completionTokens !== null && ms > 0 ? (completionTokens / ms) * 1000 : null;
    return {
      id: model.id,
      ok: conforms,
      ms,
      tokensPerSec,
      note: conforms ? "valid JSON" : `non-conforming: ${content.slice(0, 60)}`,
    };
  } catch (err) {
    return {
      id: model.id,
      ok: false,
      ms: Date.now() - t0,
      tokensPerSec: null,
      note: err instanceof Error ? err.message.slice(0, 60) : String(err),
    };
  }
}

function money(n: number): string {
  return n === 0 ? "FREE" : `$${n.toFixed(3)}`;
}

/**
 * --free-all: probe EVERY `:free` / zero-priced text model, ignoring
 * advertised parameter support — the probe is ground truth and costs
 * nothing. Emits a ready-to-paste PEPPERS_ROUTER_PREFER line of the
 * conforming models, fastest first.
 */
async function freeAll(): Promise<void> {
  const catalog = await fetchCatalog();
  const pool = catalog.filter(
    (m) =>
      isFree(m) &&
      m.modality.startsWith("text") &&
      m.modality.endsWith("->text"),
  );
  console.log(`# probing ALL ${pool.length} free text models (each probe costs $0)…\n`);
  const results: ProbeResult[] = [];
  for (const m of pool) {
    const r = await probe(m);
    results.push(r);
    console.log(
      `  ${r.ok ? "PASS" : "FAIL"}  ${String(r.ms).padStart(6)}ms  ${r.tokensPerSec !== null ? r.tokensPerSec.toFixed(0).padStart(4) + " tok/s" : "    —    "}  ${r.id}  (${r.note.slice(0, 70)})`,
    );
  }
  const conforming = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
  console.log(`\n# ${conforming.length}/${pool.length} conform. Fastest first:`);
  for (const r of conforming) {
    console.log(`  ${String(r.ms).padStart(6)}ms  ${r.id}`);
  }
  console.log(
    `\nPEPPERS_ROUTER_PREFER=${conforming.slice(0, 5).map((r) => r.id).join(",")}`,
  );
}

async function main(): Promise<void> {
  let probeCount = 8;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--probes=")) probeCount = Number(arg.slice("--probes=".length));
    if (arg === "--free-all") return freeAll();
  }

  const catalog = await fetchCatalog();
  const eligible = catalog.filter(isEligible);
  console.log(
    `# catalog: ${catalog.length} models, ${eligible.length} eligible (JSON mode + ≥16K ctx), ${eligible.filter(isFree).length} of those free\n`,
  );

  const free = rankFree(catalog);
  const paid = rankCheapestPaid(catalog);

  console.log("## 1. CHEAPEST (blended $/MTok, 3:1 prompt:completion)");
  for (const m of [...free.slice(0, 8), ...paid.slice(0, 8)]) {
    console.log(
      `  ${money(blendedPrice(m)).padStart(8)}  ctx=${String(m.contextLength).padStart(7)}  ${m.id}`,
    );
  }

  const candidates = [...free, ...paid].slice(0, probeCount);
  console.log(`\n## probing ${candidates.length} candidates (1 timed JSON call each)…`);
  const results: ProbeResult[] = [];
  for (const m of candidates) {
    const r = await probe(m);
    results.push(r);
    console.log(
      `  ${r.ok ? "PASS" : "FAIL"}  ${String(r.ms).padStart(6)}ms  ${r.tokensPerSec !== null ? r.tokensPerSec.toFixed(0).padStart(4) + " tok/s" : "    —    "}  ${r.id}  (${r.note})`,
    );
  }

  console.log("\n## 2. FASTEST (measured, conforming models only)");
  for (const r of results
    .filter((r) => r.ok && r.tokensPerSec !== null)
    .sort((a, b) => a.ms - b.ms)) {
    console.log(`  ${String(r.ms).padStart(6)}ms  ${r.tokensPerSec!.toFixed(0).padStart(4)} tok/s  ${r.id}`);
  }

  console.log("\n## 3. CONFORMANCE (proxy for 'smart enough for peppers' — real eval is the lab)");
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.id}`);
  }

  const best = results.find((r) => r.ok);
  if (best) {
    console.log(
      `\n# suggested PEPPERS_ROUTER=free-first head: ${best.id}` +
        `\n# (router re-derives this live; this is just tonight's snapshot)`,
    );
  }
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
