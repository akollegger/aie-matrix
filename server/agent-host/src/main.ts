import { loadRootEnv, isEnvTruthy } from "@aie-matrix/root-env";
import { Effect, Layer, ManagedRuntime, pipe } from "effect";
import { A2AHostServiceLive } from "./a2a-host/A2AHostService.js";
import { McpProxyServiceLive } from "./mcp-proxy/mcp-proxy.layer.js";
import { CatalogServiceLive } from "./catalog/CatalogService.js";
import { readHouseCapabilityManifest } from "./house-capabilities.js";
import { AgentSupervisorLayer, AgentSupervisor } from "./supervisor/SupervisorService.js";
import { createApp } from "./app.js";
import { startColyseusWorldBridge, type ColyseusWorldBridgeHandle } from "./colyseus-bridge/ColyseusWorldBridge.js";

loadRootEnv();

const devToken = process.env.AGENT_HOST_TOKEN ?? "";
const port = (() => {
  const p = process.env.AGENT_HOST_PORT;
  if (p == null || p === "") return 4000;
  const n = parseInt(p, 10);
  return Number.isFinite(n) ? n : 4000;
})();
const catalogFilePath = process.env.CATALOG_FILE_PATH ?? "./catalog.json";
const publicBase =
  (process.env.AGENT_HOST_PUBLIC_BASE_URL ?? "").replace(/\/$/, "") ||
  `http://127.0.0.1:${port}`;
const worldHttpBase = (process.env.AIE_MATRIX_HTTP_BASE_URL ?? "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
// IC-002: inter-service URL contract — read directly from process.env (root-env is a file loader only)
const worldApiUrl = (process.env.WORLD_API_URL ?? worldHttpBase).replace(/\/$/, "");
const colyseusUrl = process.env.COLYSEUS_URL ?? worldHttpBase.replace(/^http/, "ws");

if (devToken.length === 0) {
  console.error("AGENT_HOST_TOKEN is required");
  process.exit(1);
}

const base = Layer.mergeAll(CatalogServiceLive(catalogFilePath), A2AHostServiceLive(devToken));

export const appLayer = Layer.mergeAll(
  base,
  McpProxyServiceLive,
  Layer.provide(
    AgentSupervisorLayer({
      publicHouseBaseUrl: publicBase,
      defaultCapabilityManifest: readHouseCapabilityManifest(),
    }),
    base,
  ),
);

const runtime = ManagedRuntime.make(appLayer);

const app = createApp(runtime, { devToken, publicBase, worldApiUrl });

let colyseusHandle: ColyseusWorldBridgeHandle | undefined;

const server = app.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({ kind: "agent-host.start", publicBase, port, catalog: catalogFilePath, worldApiUrl, colyseusUrl }),
  );
  if (!isEnvTruthy(process.env.AGENT_HOST_DISABLE_COLYSEUS_BRIDGE)) {
    const roomIdOverride = process.env.GHOST_SPECTATOR_ROOM_ID?.trim() || undefined;
    void (async () => {
      try {
        const deliverWorldEvent = await runtime.runPromise(
          pipe(AgentSupervisor, Effect.map((s) => s.deliverWorldEvent.bind(s))),
        );
        colyseusHandle = await startColyseusWorldBridge({
          worldHttpBase,
          roomIdOverride,
          onEvent: (ev) => {
            void runtime.runPromise(deliverWorldEvent(ev));
          },
        });
        console.info(
          JSON.stringify({
            kind: "colyseus.world-bridge.started",
            worldHttpBase,
            roomIdOverride: roomIdOverride ?? null,
          }),
        );
      } catch (e) {
        console.error(
          JSON.stringify({
            kind: "colyseus.world-bridge.failed",
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    })();
  }
});

const shutdown = async () => {
  colyseusHandle?.close();
  await runtime.dispose();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
