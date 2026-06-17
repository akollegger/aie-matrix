import { loadRootEnv, isEnvTruthy } from "@aie-matrix/root-env";
import { createLogger } from "@aie-matrix/logger";
import { Effect, Layer, ManagedRuntime, pipe } from "effect";
import { A2AHostServiceLive } from "./a2a-host/A2AHostService.js";
import { McpProxyServiceLive } from "./mcp-proxy/mcp-proxy.layer.js";
import { CatalogService, CatalogServiceLive } from "./catalog/CatalogService.js";
import type { CatalogEntry } from "./types.js";
import { readHouseCapabilityManifest } from "./house-capabilities.js";
import { AgentSupervisorLayer, AgentSupervisor } from "./supervisor/SupervisorService.js";
import { createApp } from "./app.js";
import { startColyseusWorldBridge, type ColyseusWorldBridgeHandle } from "./colyseus-bridge/ColyseusWorldBridge.js";
import {
  BarnacleSupervisor,
  BarnacleSupervisorLayer,
  startBarnacleEncounterTrigger,
  type EncounterTriggerHandle,
} from "./barnacle/index.js";

loadRootEnv();

const log = createLogger("agent-host");

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
// In-cluster URL for MCP / push-ingest endpoints sent to ghost agents.
// Must be reachable from agent pods without going through the external proxy.
// Defaults to publicBase when not set (local dev: both are loopback).
const internalBase =
  (process.env.AGENT_HOST_INTERNAL_BASE_URL ?? "").replace(/\/$/, "") || publicBase;
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
      internalHouseBaseUrl: internalBase,
      worldHttpBase,
      defaultCapabilityManifest: readHouseCapabilityManifest(),
      pushIngestToken: devToken,
    }),
    base,
  ),
  // RFC-0019 Barnacle supervisor — handles mini-game session lifecycles.
  Layer.provide(
    BarnacleSupervisorLayer({
      registryBaseUrl: worldHttpBase,
      devToken,
      publicSupervisorA2A: `${publicBase}/v1/internal/barnacle-complete`,
    }),
    base,
  ),
);

const runtime = ManagedRuntime.make(appLayer);

const app = createApp(runtime, { devToken, publicBase, worldApiUrl });

let colyseusHandle: ColyseusWorldBridgeHandle | undefined;
let barnacleEncounterHandle: EncounterTriggerHandle | undefined;

const server = app.listen(port, "0.0.0.0", () => {
  log.info({ kind: "start", publicBase, port, catalog: catalogFilePath, worldApiUrl, colyseusUrl });
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
        log.info({
          kind: "colyseus.world-bridge.started",
          worldHttpBase,
          roomIdOverride: roomIdOverride ?? null,
        });
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

  // RFC-0019 — Barnacle encounter trigger. ON by default since phase
  // 5b.2c; set `AIE_MATRIX_BARNACLE_ENCOUNTERS=0` to opt out (legacy
  // spectator-only smoke tests with no mini-games registered).
  const barnacleEncountersEnabled =
    process.env.AIE_MATRIX_BARNACLE_ENCOUNTERS !== "0";
  if (barnacleEncountersEnabled) {
    void (async () => {
      try {
        log.info({ kind: "barnacle.encounter-trigger.bootstrap", phase: "resolving-services" });
        const catalog = await runtime.runPromise(
          pipe(CatalogService, Effect.map((c) => c)),
        );
        log.info({ kind: "barnacle.encounter-trigger.bootstrap", phase: "catalog-resolved" });
        const agentSupervisor = await runtime.runPromise(
          pipe(AgentSupervisor, Effect.map((s) => s)),
        );
        log.info({ kind: "barnacle.encounter-trigger.bootstrap", phase: "agent-supervisor-resolved" });
        const barnacleSupervisor = await runtime.runPromise(
          pipe(BarnacleSupervisor, Effect.map((s) => s)),
        );
        log.info({ kind: "barnacle.encounter-trigger.bootstrap", phase: "barnacle-supervisor-resolved" });
        barnacleEncounterHandle = await startBarnacleEncounterTrigger({
          worldHttpBase,
          registryBaseUrl: worldHttpBase,
          devToken,
          catalog,
          agentSupervisor,
          barnacleSupervisor,
        });
      } catch (e) {
        console.error(
          JSON.stringify({
            kind: "barnacle.encounter-trigger.failed-to-start",
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    })();
  }

  // Startup reconciliation: if a live session is already active (e.g. after a pod
  // restart), spawn all roster agents' ghosts without waiting for world.session.start.
  //
  // In a cold-start (full cluster restart), ghost agents self-register after agent-host
  // starts. We poll the catalog until rosterAgent entries appear before spawning, so
  // reconciliation works even when the catalog starts empty.
  if (process.env.AGENT_HOST_DISABLE_RECONCILIATION !== "1") {
    const reconciliationWaitMs = (() => {
      const raw = process.env.AGENT_HOST_RECONCILIATION_WAIT_MS;
      const n = raw !== undefined ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : 30_000;
    })();
    void (async () => {
      try {
        const liveRes = await fetch(`${worldApiUrl}/live?status=active`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!liveRes.ok) return;
        const sessions = (await liveRes.json()) as Array<{ id: string }>;
        if (!Array.isArray(sessions) || sessions.length === 0) {
          log.info({ kind: "agent-host.startup-reconciliation.no-active-session" });
          return;
        }
        log.info({
          kind: "agent-host.startup-reconciliation.found-session",
          sessionId: sessions[0]!.id,
        });

        const supervisor = await runtime.runPromise(
          pipe(AgentSupervisor, Effect.map((s) => s)),
        );
        const catalog = await runtime.runPromise(
          pipe(CatalogService, Effect.map((c) => c)),
        );

        // Poll until at least one rosterAgent entry is registered, or we time out.
        // Ghost agents (random-agent, npc-agent) register after agent-host starts, so
        // on a cold start the catalog is empty at reconciliation time.
        const rosterPollStart = Date.now();
        let rosterEntries: Array<[string, CatalogEntry]> = [];
        while (true) {
          const catalogFile = await runtime.runPromise(catalog.load());
          rosterEntries = Object.entries(catalogFile.agents).filter(([, entry]) => {
            if (entry.kind === "mini-game") return false;
            return (entry.agentCard as { matrix?: { rosterAgent?: boolean } }).matrix?.rosterAgent === true;
          });
          if (rosterEntries.length > 0) break;
          const elapsed = Date.now() - rosterPollStart;
          if (elapsed >= reconciliationWaitMs) {
            log.info({
              kind: "agent-host.startup-reconciliation.no-roster-agents",
              note: `timed out after ${elapsed}ms waiting for rosterAgent registrations`,
            });
            return;
          }
          log.info({
            kind: "agent-host.startup-reconciliation.waiting-for-roster-agents",
            elapsedMs: elapsed,
            waitMs: reconciliationWaitMs,
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        }

        for (const [agentId, entry] of rosterEntries) {
          const result = await runtime.runPromise(
            supervisor.spawnRosterForAgent(agentId, entry.baseUrl),
          );
          log.info({
            kind: "agent-host.startup-reconciliation.roster-spawn-complete",
            agentId,
            spawned: result.spawned.length,
            failed: result.failed.length,
          });
        }
      } catch (e) {
        console.error(
          JSON.stringify({
            kind: "agent-host.startup-reconciliation.failed",
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    })();
  }
});

const shutdown = async () => {
  colyseusHandle?.close();
  await barnacleEncounterHandle?.close();
  await runtime.dispose();
  // closeAllConnections() force-closes keep-alive HTTP connections so server.close()
  // doesn't wait indefinitely for clients (health probes, registered ghosts) to disconnect.
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

// Hard 25s deadline: ensures the process always exits before K8s force-kills at
// terminationGracePeriodSeconds (30s). Without this, a hung runtime.dispose() or
// a keep-alive connection would cause Helm --wait to time out on rolling deploys.
const shutdownWithDeadline = () =>
  Promise.race([
    shutdown(),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn(JSON.stringify({ kind: "agent-host.shutdown-timeout", note: "forcing exit after 25s" }));
        resolve();
      }, 25_000),
    ),
  ]);

process.on("SIGINT", () => {
  void shutdownWithDeadline().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdownWithDeadline().finally(() => process.exit(0));
});
