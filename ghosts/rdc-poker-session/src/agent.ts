/**
 * RDC agent main entry. Mirrors peppers-agent's bootstrap pattern.
 *
 * One process serves one ghost (or one shared catalog of ghosts in
 * v1 — the executor's per-ghost map handles multiple). The agent
 * listens on its own port for A2A traffic from the orchestrator.
 */

import { loadRootEnv } from "@aie-matrix/root-env";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import { buildRdcAgentCard } from "./buildAgentCard.js";
import {
  RdcAgentExecutor,
  getLedger,
  setActiveTable,
} from "./executor.js";
import { startSessionLoop } from "./session-loop.js";
import { OverlayBroadcaster, mountOverlay } from "./overlay-server.js";
import type { TableConfig } from "./table-state.js";

loadRootEnv();

function listenPortFromEnv(fallback: number): number {
  const raw = process.env.RDC_AGENT_PORT;
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * RFC-0019 phase 5b.2b — read per-table session config from env. When
 * `RDC_PLATFORM_ID` is set, the process binds an `ActiveTable` and
 * starts the auto-loop. Absent, the process stays in legacy mode
 * (per-ghost executor map, orchestrator-driven). The cutover that makes
 * the active-table mode mandatory lands in 5b.2c.
 */
function tableConfigFromEnv(): TableConfig | null {
  const platformId = process.env.RDC_PLATFORM_ID?.trim();
  if (!platformId) return null;
  return {
    platformId,
    platformClass: process.env.RDC_PLATFORM_CLASS?.trim() || "PokerTable",
    capacity: intEnv("RDC_CAPACITY", 6),
    minPlayers: intEnv("RDC_MIN_PLAYERS", 2),
    buyIn: intEnv("RDC_BUY_IN", 100),
    smallBlind: intEnv("RDC_SMALL_BLIND", 5),
    bigBlind: intEnv("RDC_BIG_BLIND", 10),
    setting:
      process.env.RDC_SETTING?.trim() ||
      "A dust-blown saloon on the edge of the convention",
  };
}

const dev = process.env.AGENT_HOST_TOKEN ?? "";
const port = listenPortFromEnv(4012);
const publicBase = (
  process.env.RDC_AGENT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`
).replace(/\/$/, "");

const agentCard = buildRdcAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new RdcAgentExecutor(),
);

const requireToken: RequestHandler = (req: Request, res: Response, next) => {
  if (dev.length === 0) {
    return res.status(500).json({ error: "AGENT_HOST_TOKEN is not set" });
  }
  if (req.headers.authorization === `Bearer ${dev}`) {
    return next();
  }
  return res.status(401).json({ error: "unauthorized" });
};

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(
  "/a2a/jsonrpc",
  requireToken,
  jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
);

// Saloon overlay (RFC-0019) — mounted on the same port as A2A so the
// session process is one box you point a browser at. Routes:
//   GET /        → overlay/index.html
//   GET /events  → SSE stream (snapshot + live hand events)
const overlay = new OverlayBroadcaster();
mountOverlay(app, overlay);

app.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      kind: "rdc-agent.start",
      publicBase,
      port,
      card: `http://127.0.0.1:${port}/.well-known/agent-card.json`,
    }),
  );

  // RFC-0019 phase 5b.2b — if env declares a table, bind it and start
  // the auto-loop. Handoffs arriving after this seat into the active
  // table and the loop deals as soon as `minPlayers` is met.
  const tableConfig = tableConfigFromEnv();
  if (tableConfig) {
    const table = setActiveTable(tableConfig);
    const ledger = getLedger();
    // Seed the overlay snapshot so a browser that loads the page before
    // the first hand still sees the table config + lobby.
    overlay.setSnapshot({
      table: {
        platformId: tableConfig.platformId,
        platformClass: tableConfig.platformClass,
        capacity: tableConfig.capacity,
        minPlayers: tableConfig.minPlayers,
        buyIn: tableConfig.buyIn,
        smallBlind: tableConfig.smallBlind,
        bigBlind: tableConfig.bigBlind,
        setting: tableConfig.setting,
      },
      agents: [],
      balances: {},
    });
    const handle = startSessionLoop({
      activeTable: table,
      ledger,
      persistMemory: process.env.RDC_PERSIST_MEMORY === "1",
      onTableEvent: ({ tableId, event }) => {
        // Maps directly to the overlay's `table-event` handler shape
        // (id + event), matching the legacy orchestrator stream.
        overlay.emit("table-event", { id: tableId, event });
      },
      onLifecycle: (ev) => {
        switch (ev.kind) {
          case "hand-deal":
            // Emit `table-created` so the overlay flips to a fresh table
            // view with the seat roster, animals, and tier badges.
            overlay.emit("table-created", {
              id: ev.tableId,
              handNumber: ev.handNumber,
              seats: ev.seats,
              animals: ev.animals,
              tiers: ev.tiers,
              setting: tableConfig.setting,
            });
            break;
          case "hand-settled":
            overlay.emit("table-complete", {
              id: ev.tableId,
              netChanges: ev.netChanges,
            });
            // Refresh the ledger panel snapshot so reconnecting clients
            // see current balances.
            overlay.patchSnapshot({ balances: { ...ledger.snapshot().balances } });
            overlay.emit("snapshot", { balances: { ...ledger.snapshot().balances } });
            break;
          case "seat-released":
            overlay.emit("platform-exit", {
              ghostId: ev.ghostId,
              displayName: ev.displayName,
              reason: ev.reason,
              narrative: ev.narrative ?? null,
            });
            break;
        }
      },
    });
    const shutdown = (sig: string) => {
      console.info(JSON.stringify({ kind: "rdc-poker-session.shutdown", signal: sig }));
      handle.stop();
      process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } else {
    console.info(
      JSON.stringify({
        kind: "rdc-poker-session.legacy-mode",
        reason: "RDC_PLATFORM_ID not set — running as legacy per-ghost A2A agent",
      }),
    );
  }
});
