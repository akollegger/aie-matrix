import Phaser from "phaser";
import { Client, MatchMakeError, type Room } from "colyseus.js";
import { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import { spectatorDebugEnabled } from "./spectatorDebug.js";
import { WorldScene } from "./scenes/WorldScene.js";

/**
 * Map/tile assets are copied into `public/maps` (see `scripts/copy-map-assets.mjs` + `predev` / `prebuild`)
 * and loaded from the same origin as the page (`import.meta.env.BASE_URL`).
 *
 * In Vite dev, `/spectator` is proxied to the game server (see `vite.config.ts`). Colyseus must use
 * the same origin as that proxy (`VITE_SERVER_HTTP`, then `VITE_DEV_PROXY_TARGET`, else :8787).
 * `VITE_SERVER_WS` overrides the WebSocket URL when set.
 */
const assetBaseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

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

/** Refetch room id + join; retries when the game server just restarted (stale id) or matchmaker races. */
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
  const room = await joinSpectatorWithRetry();
  room.onMessage("ghost-patch", () => {
    // MatrixRoom broadcasts this for non-schema tooling; the Phaser view uses synced schema state.
  });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "app",
    width: 960,
    height: 720,
    backgroundColor: "#0f0f18",
    // Cross-origin map PNGs must use CORS mode or WebGL textures fail (looks like a CORS error).
    loader: {
      crossOrigin: "anonymous",
    },
  });

  game.scene.add("WorldScene", WorldScene, false);
  game.scene.start("WorldScene", {
    room,
    assetBaseUrl,
    spectatorDebug: spectatorDebugEnabled(),
  });
}

void bootstrap().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) {
    app.textContent = `Spectator failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
