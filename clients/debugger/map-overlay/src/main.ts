import { Client, MatchMakeError, type Room } from "colyseus.js";
import { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import { GhostOverlay } from "./overlay.js";
import { initMaplibreMap } from "./map.js";

declare const __AIE_MAP_PATH__: string;

const serverHttp = (
  import.meta.env.VITE_SERVER_HTTP ??
  (import.meta.env.DEV ? "" : "http://127.0.0.1:8787")
).replace(/\/$/, "");

const backendHttp = (
  import.meta.env.VITE_SERVER_HTTP ??
  import.meta.env.VITE_DEV_PROXY_TARGET ??
  "http://127.0.0.1:8787"
).replace(/\/$/, "");
const wsUrl = (import.meta.env.VITE_SERVER_WS ?? backendHttp.replace(/^http/, "ws")) as string;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAnchorH3FromMap(): Promise<string> {
  const rel = __AIE_MAP_PATH__;
  const res = await fetch(`${serverHttp}/maps/${rel}`);
  if (!res.ok) {
    throw new Error(`Failed to load map metadata (${res.status}): /maps/${rel}`);
  }
  const tmj = (await res.json()) as {
    properties?: ReadonlyArray<{ name?: string; value?: unknown }>;
  };
  const raw = tmj.properties?.find((p) => p.name === "h3_anchor")?.value;
  const anchor = typeof raw === "string" ? raw.trim() : raw != null ? String(raw).trim() : "";
  if (!anchor) {
    throw new Error("Map JSON missing h3_anchor property");
  }
  return anchor;
}

async function joinSpectatorWithRetry(): Promise<Room<WorldSpectatorState>> {
  const client = new Client(wsUrl);
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const meta = await fetch(`${serverHttp}/spectator/room`);
    if (!meta.ok) {
      throw new Error(`spectator/room failed: ${meta.status} ${await meta.text()}`);
    }
    const { roomId } = (await meta.json()) as { roomId: string };
    try {
      return await client.joinById<WorldSpectatorState>(roomId, {}, WorldSpectatorState);
    } catch (e) {
      const retriable =
        e instanceof MatchMakeError &&
        (e.code === 4212 || e.message.toLowerCase().includes("not found") || e.message.includes("4212"));
      if (retriable && attempt < maxAttempts - 1) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw new Error("joinSpectatorWithRetry: exhausted retries");
}

async function bootstrap(): Promise<void> {
  const [anchorH3, room] = await Promise.all([loadAnchorH3FromMap(), joinSpectatorWithRetry()]);
  const container = document.getElementById("map");
  if (!container) {
    throw new Error("#map missing");
  }
  const map = initMaplibreMap(container, anchorH3);
  const overlay = new GhostOverlay(map);

  const syncGhostTiles = (): void => {
    room.state.ghostTiles.forEach((h3, ghostId) => {
      overlay.updateGhost(ghostId, h3);
    });
  };

  room.state.ghostTiles.onAdd((h3, ghostId) => {
    overlay.updateGhost(ghostId, h3);
  });
  room.state.ghostTiles.onChange((h3, ghostId) => {
    overlay.updateGhost(ghostId, h3);
  });
  room.state.ghostTiles.onRemove((_h3, ghostId) => {
    overlay.removeGhost(ghostId);
  });

  const onReady = (): void => {
    syncGhostTiles();
  };
  if (map.isStyleLoaded()) {
    onReady();
  } else {
    map.on("load", onReady);
  }
}

void bootstrap().catch((err) => {
  console.error(err);
  const mapEl = document.getElementById("map");
  if (mapEl) {
    mapEl.textContent = `Overlay failed: ${err instanceof Error ? err.message : String(err)}`;
  }
});
