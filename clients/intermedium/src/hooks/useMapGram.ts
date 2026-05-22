import { useCallback, useEffect, useState } from "react";
import { parseMapGramToTiles, type TileTypeStyles } from "../services/gramParser.js";
import type { WorldTile } from "../types/worldTile.js";
import type { MapGramStatus } from "../types/spectator.js";

const RETRIES = 3;
const BACKOFF_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function currentMapUrl(base: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${b}/live/@current/map`;
}

/**
 * Fetches and parses the world map once. Retries 3× with 2s backoff (FR-023, SC-004).
 */
export function useMapGram(): {
  readonly status: MapGramStatus;
  readonly tiles: ReadonlyMap<string, WorldTile>;
  readonly tileTypeStyles: TileTypeStyles;
  readonly error: string | null;
  readonly retry: () => void;
} {
  const [status, setStatus] = useState<MapGramStatus>("loading");
  const [tiles, setTiles] = useState<ReadonlyMap<string, WorldTile>>(() => new Map());
  const [tileTypeStyles, setTileTypeStyles] = useState<TileTypeStyles>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base) {
      setError("VITE_API_BASE_URL is not set");
      setStatus("error");
      return;
    }
    const url = currentMapUrl(base);
    setError(null);
    setStatus("loading");
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: "text/plain" } });
        if (!res.ok) {
          throw new Error(`Map fetch failed: HTTP ${res.status}`);
        }
        const text = await res.text();
        const { tiles: m, tileTypeStyles: s } = await parseMapGramToTiles(text);
        setTiles(m);
        setTileTypeStyles(s);
        setStatus("ready");
        return;
      } catch (e) {
        if (attempt < RETRIES - 1) {
          await sleep(BACKOFF_MS);
        } else {
          const msg = e instanceof Error ? e.message : "Map load failed";
          console.error(`[intermedium] map load failed (${url}):`, e);
          setError(msg);
          setStatus("error");
        }
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, tiles, tileTypeStyles, error, retry: load };
}
