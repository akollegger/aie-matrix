import { useCallback, useEffect, useState } from "react";
import { parseMapGramToTiles } from "../services/gramParser.js";
import type { WorldTile } from "../types/worldTile.js";
import type { MapGramStatus } from "../types/spectator.js";

const RETRIES = 3;
const BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapUrl(base: string, mapId: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${b}/maps/${encodeURIComponent(mapId)}?format=gram`;
}

/**
 * Fetches and parses the world map once. Retries 3× with 2s backoff (FR-023, SC-004).
 */
export function useMapGram(): {
  readonly status: MapGramStatus;
  readonly tiles: ReadonlyMap<string, WorldTile>;
  readonly error: string | null;
  readonly retry: () => void;
} {
  const [status, setStatus] = useState<MapGramStatus>("loading");
  const [tiles, setTiles] = useState<ReadonlyMap<string, WorldTile>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const base = import.meta.env.VITE_WORLD_API_URL ?? "";
    const mapId = import.meta.env.VITE_MAP_ID ?? "sandbox";
    if (!base) {
      setError("VITE_WORLD_API_URL is not set");
      setStatus("error");
      return;
    }
    setError(null);
    setStatus("loading");
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const res = await fetch(mapUrl(base, mapId), {
          headers: { Accept: "text/plain" },
        });
        if (!res.ok) {
          throw new Error(`Map fetch failed: HTTP ${res.status}`);
        }
        const text = await res.text();
        const m = await parseMapGramToTiles(text);
        setTiles(m);
        setStatus("ready");
        return;
      } catch (e) {
        if (attempt < RETRIES - 1) {
          await sleep(BACKOFF_MS);
        } else {
          setError(e instanceof Error ? e.message : "Map load failed");
          setStatus("error");
        }
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, tiles, error, retry: load };
}
