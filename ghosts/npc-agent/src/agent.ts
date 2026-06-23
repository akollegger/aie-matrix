import { loadRootEnv } from "@aie-matrix/root-env";
import { createLogger } from "@aie-matrix/logger";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import express, { type Request, type RequestHandler, type Response } from "express";
import { join } from "node:path";
import { buildNpcAgentCard } from "./buildAgentCard.js";
import { NpcAgentExecutor, initExecutor, getDialogStateSnapshot, getDegradedGhosts } from "./executor.js";
import { loadCatalog } from "./catalog/catalog-loader.js";
import { startHeartbeat } from "./heartbeat.js";
import type { NpcAgentCatalog } from "./types.js";

loadRootEnv();

const log = createLogger("npc-agent");

function listenPortFromEnv(fallback: number): number {
  const raw = process.env.AGENT_PORT;
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback;
}

const token = process.env.AGENT_HOST_TOKEN ?? "";
const agentHostUrl = (process.env.AGENT_HOST_URL ?? "").replace(/\/$/, "");
const port = listenPortFromEnv(4004);
const publicBase = (
  process.env.NPC_AGENT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`
).replace(/\/$/, "");
const agentId = process.env.AGENT_ID ?? process.env.HOSTNAME ?? "npc-agent-local";
const registerTimeoutMs = (() => {
  const raw = process.env.AGENT_REGISTER_TIMEOUT;
  if (!raw) return 120_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
})();

let loadedCatalog: NpcAgentCatalog | null = null;

const agentCard = buildNpcAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new NpcAgentExecutor(),
);

const requireToken: RequestHandler = (req: Request, res: Response, next) => {
  if (token.length === 0) {
    return res.status(500).json({ error: "AGENT_HOST_TOKEN is not set" });
  }
  if (req.headers.authorization === `Bearer ${token}`) return next();
  return res.status(401).json({ error: "unauthorized" });
};

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  const degraded = getDegradedGhosts();
  if (degraded.size > 0) {
    const ghosts = [...degraded].map((ghostId) => ({ ghostId, status: "degraded" }));
    res.status(503).json({ status: "degraded", ghosts });
    return;
  }
  res.json({ status: "ok" });
});

app.get("/v1/roster", (_req, res) => {
  if (!loadedCatalog) {
    res.json([]);
    return;
  }
  res.json(loadedCatalog.enabled().map((c) => ({
    characterId: c.id,
    displayName: c.name,
    ...(c.background ? { background: c.background } : {}),
  })));
});

// T030: introspection endpoint for TCK — returns current per-character dialog state.
app.get("/_tck/dialog", requireToken, (_req, res) => {
  res.json(getDialogStateSnapshot());
});

app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(
  "/a2a/jsonrpc",
  requireToken,
  jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
);

function startHeartbeatAfterRegistration(): void {
  if (!agentHostUrl) return;
  startHeartbeat({
    agentId,
    agentHostUrl,
    token,
    onNotRegistered: () => { void reRegister(); },
  });
}

// Re-register after agent-host bounced and lost this agent's catalog entry.
async function reRegister(): Promise<void> {
  if (!agentHostUrl) return;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  let attempt = 0;
  for (;;) {
    const delayMs = Math.min(5_000 * 2 ** attempt, 120_000);
    log.warn({ kind: "npc-agent.registration.retry", agentId, attempt, delayMs });
    await new Promise((r) => setTimeout(r, delayMs));
    attempt++;
    try {
      const res = await fetch(`${agentHostUrl}/v1/catalog/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId, baseUrl: publicBase }),
      });
      if (res.ok || res.status === 201 || res.status === 409) {
        log.info({ kind: "npc-agent.reregistered", agentId });
        startHeartbeatAfterRegistration();
        return;
      }
    } catch {
      // agent-host still unreachable
    }
  }
}

async function register(): Promise<void> {
  if (!agentHostUrl) {
    log.warn({ kind: "npc-agent.registration-skipped", reason: "AGENT_HOST_URL not set" });
    return;
  }

  const deadline = Date.now() + registerTimeoutMs;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  try {
    const del = await fetch(`${agentHostUrl}/v1/catalog/${agentId}`, { method: "DELETE", headers });
    if (del.status === 409) {
      log.warn({ kind: "npc-agent.deregister-conflict", agentId, note: "active sessions; skipping deregister" });
    }
  } catch {
    // network error during delete — continue
  }

  // Phase 1: fast retry (2 s interval) for up to registerTimeoutMs
  for (;;) {
    try {
      const res = await fetch(`${agentHostUrl}/v1/catalog/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId, baseUrl: publicBase }),
      });
      if (res.ok || res.status === 201) {
        log.info({ kind: "npc-agent.registered", agentId });
        startHeartbeatAfterRegistration();
        return;
      }
      if (res.status === 409) {
        log.warn({ kind: "npc-agent.already-registered", agentId });
        startHeartbeatAfterRegistration();
        return;
      }
      log.warn({ kind: "npc-agent.registration-error", status: res.status });
    } catch {
      // agent-host not yet ready
    }

    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 2_000));
  }

  // Phase 2: agent-host was not reachable within the fast window — keep retrying with
  // exponential backoff rather than exiting. The pod stays alive for health checks.
  log.warn({ kind: "npc-agent.registration-timeout", agentId, note: "switching to backoff retry" });
  await reRegister();
}

async function deregister(): Promise<void> {
  if (!agentHostUrl) return;
  try {
    await fetch(`${agentHostUrl}/v1/catalog/${agentId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // ignore errors on shutdown
  }
}

process.on("SIGTERM", () => {
  const timeout = setTimeout(() => process.exit(0), 10_000);
  timeout.unref();
  deregister().then(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
});

const catalogDir = process.env.NPC_CATALOG_DIR
  ? process.env.NPC_CATALOG_DIR
  : join(process.cwd(), "catalog");

app.listen(port, "0.0.0.0", () => {
  log.info({ kind: "start", publicBase, port, agentId });
  loadCatalog(catalogDir).then((cat) => {
    loadedCatalog = cat;
    initExecutor({ catalog: cat, catalogDir, agentHostUrl, agentId });
    register();
  }).catch((e: unknown) => {
    console.error(JSON.stringify({ kind: "npc-agent.catalog-load-failed", error: String(e) }));
    register(); // still register even if catalog fails
  });
});
