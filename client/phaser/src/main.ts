import Phaser from "phaser";
import { Client, MatchMakeError, type Room } from "colyseus.js";
import { WorldSpectatorState } from "@aie-matrix/server-colyseus/room-schema";
import { spectatorDebugEnabled } from "./spectatorDebug.js";
import { WorldScene } from "./scenes/WorldScene.js";

/**
 * Map/tile assets are copied into `public/maps` (see `scripts/copy-map-assets.mjs` + `predev` / `prebuild`)
 * and loaded from the same origin as the page (`import.meta.env.BASE_URL`).
 *
 * In Vite dev, spectator + matchmake + threads + Colyseus room WebSockets are proxied (see
 * `vite.config.ts`). `urlBuilder` rewrites matchmake and WS URLs to the page origin so the browser
 * only talks to the Vite port (needed when the game server port is not reachable from the browser).
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

/**
 * Colyseus HTTP uses `withCredentials` on matchmake calls. In Vite dev, route matchmake + WS through
 * the dev origin so requests stay same-origin and can use the dev-server proxy (`ws: true` for rooms).
 * Skip WS rewriting when `VITE_SERVER_WS` is set — that URL is intentional (custom host/tunnel).
 */
function colyseusBrowserDevUrlBuilder(): ((url: URL) => string) | undefined {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return undefined;
  }
  const wsManual =
    typeof import.meta.env.VITE_SERVER_WS === "string" &&
    import.meta.env.VITE_SERVER_WS.length > 0;
  return (url: URL) => {
    if (url.pathname.includes("/matchmake")) {
      return `${window.location.origin}${url.pathname}${url.search}`;
    }
    if (
      !wsManual &&
      (url.protocol === "ws:" || url.protocol === "wss:")
    ) {
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProto}//${window.location.host}${url.pathname}${url.search}`;
    }
    return url.href;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Refetch room id + join; retries when the game server just restarted (stale id) or matchmaker races. */
async function joinSpectatorWithRetry(): Promise<Room<WorldSpectatorState>> {
  const urlBuilder = colyseusBrowserDevUrlBuilder();
  const client = new Client(wsUrl, urlBuilder ? { urlBuilder } : undefined);
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
