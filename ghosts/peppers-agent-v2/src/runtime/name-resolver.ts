/**
 * GhostId → displayName resolver.
 *
 * Peppers cascade output (overlay labels, monologue references, Surface
 * prompt's nearby-ghost list) historically used `ghost_<8-char hash>`
 * because peppers had no source of truth for other ghosts' names. With
 * `displayName` now stored on the registry's GhostRecord, peppers can
 * resolve it lazily via `GET /registry/ghosts/:id` and cache hits.
 *
 * The resolver:
 *   - returns the cached name immediately if known
 *   - returns the `ghost_<prefix>` fallback synchronously when unknown,
 *     and kicks off an async fetch to populate the cache for next time
 *   - never throws; failed fetches log + leave the cache empty
 *
 * Callers shouldn't await — the fallback is good enough for the first
 * sighting, and subsequent ticks see the real name. The cache is
 * process-local; the agent-host process is one-per-cluster of ghosts
 * so cross-ghost cache sharing inside the same peppers-agent process
 * is automatic.
 *
 * Cache key is full ghostId. Negative results (404, errors) are also
 * cached for `NEGATIVE_TTL_MS` so we don't hammer the registry for an
 * unknown ghost on every prompt build.
 */
const NEGATIVE_TTL_MS = 30_000;

interface CacheEntry {
  readonly name: string | null;
  readonly fetchedAt: number;
}

/** ghostId → displayName (or null if registry returned nothing). */
const cache = new Map<string, CacheEntry>();
/** ghostId → in-flight fetch promise (deduplicates concurrent lookups). */
const inflight = new Map<string, Promise<string | null>>();

/** Neutral fallback — shown when the registry hasn't answered yet, or the
 *  ghost has no registered displayName. NEVER expose a raw `ghost_<hash>`
 *  handle: it leaks into spoken dialogue (the model addresses peers by the
 *  UUID, or invents a name to replace it). A first-sighting peer genuinely
 *  has no known name yet, so "a stranger" is the honest label; the async
 *  fetch fills in the real name for the next tick. */
function fallback(_ghostId: string): string {
  return "a stranger";
}

/**
 * Final-boundary scrub: replace any raw ghost handle (full UUID or
 * `ghost_<hash>`) that slipped through into prompt text with a neutral
 * descriptor. Defends the spoken/reasoning surface against EVERY leak
 * path (worldContext peer ids, addressee fields, raw MCP echoes) — a model
 * must never see, and therefore never speak, a machine identifier.
 */
const RAW_ID_RE =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ghost_[0-9a-f]{6,})\b/gi;
export function scrubRawGhostIds(text: string): string {
  return text.replace(RAW_ID_RE, "a stranger");
}

/**
 * Synchronous lookup. If the name is cached (and fresh enough), return
 * it; otherwise return the fallback AND kick off a background fetch so
 * the next call resolves the real name.
 */
export function resolveDisplayNameSync(
  registryBase: string,
  ghostId: string,
): string {
  if (!ghostId) return "?";
  const cached = cache.get(ghostId);
  if (cached) {
    if (cached.name !== null) return cached.name;
    // Negative cache — refresh once TTL elapses.
    if (Date.now() - cached.fetchedAt < NEGATIVE_TTL_MS) {
      return fallback(ghostId);
    }
  }
  // Fire-and-forget fetch.
  void prefetchDisplayName(registryBase, ghostId);
  return fallback(ghostId);
}

/**
 * Async fetch + cache. Safe to call from anywhere; concurrent calls for
 * the same ghostId share a single fetch.
 */
export async function prefetchDisplayName(
  registryBase: string,
  ghostId: string,
): Promise<string | null> {
  if (!ghostId) return null;
  const existing = inflight.get(ghostId);
  if (existing) return existing;
  const base = registryBase.replace(/\/+$/, "");
  const url = `${base}/registry/ghosts/${encodeURIComponent(ghostId)}`;
  const fetchP = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        cache.set(ghostId, { name: null, fetchedAt: Date.now() });
        return null;
      }
      const body = (await res.json()) as { displayName?: string };
      const name =
        typeof body.displayName === "string" && body.displayName.trim().length > 0
          ? body.displayName.trim()
          : null;
      cache.set(ghostId, { name, fetchedAt: Date.now() });
      return name;
    } catch {
      cache.set(ghostId, { name: null, fetchedAt: Date.now() });
      return null;
    } finally {
      inflight.delete(ghostId);
    }
  })();
  inflight.set(ghostId, fetchP);
  return fetchP;
}

/** Manual cache prime — useful when peppers already knows its own
 *  displayName (e.g. from spawn-context). Avoids the first-sighting
 *  fallback for self-references. */
export function primeDisplayName(ghostId: string, displayName: string): void {
  cache.set(ghostId, { name: displayName, fetchedAt: Date.now() });
}
