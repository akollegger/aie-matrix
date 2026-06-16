import { loadRootEnv } from "@aie-matrix/root-env";
import { createLogger } from "@aie-matrix/logger";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import express, { type Request, type RequestHandler, type Response } from "express";
import { buildWandererAgentCard } from "./buildAgentCard.js";
import { RandomWandererExecutor } from "./executor.js";

loadRootEnv();
const log = createLogger("random-agent");

function listenPortFromEnv(fallback: number): number {
  const raw = process.env.AGENT_PORT;
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback;
}

const token = process.env.AGENT_HOST_TOKEN ?? "";
const agentHostUrl = (process.env.AGENT_HOST_URL ?? "").replace(/\/$/, "");
const port = listenPortFromEnv(4001);
const publicBase = (process.env.RANDOM_AGENT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(
  /\/$/,
  "",
);
const agentId = process.env.HOSTNAME ?? "random-agent-local";
const registerTimeoutMs = (() => {
  const raw = process.env.AGENT_REGISTER_TIMEOUT;
  if (!raw) return 120_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
})();

const agentCard = buildWandererAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new RandomWandererExecutor(),
);

const requireToken: RequestHandler = (req: Request, res: Response, next) => {
  if (token.length === 0) {
    return res.status(500).json({ error: "AGENT_HOST_TOKEN is not set" });
  }
  if (req.headers.authorization === `Bearer ${token}`) {
    return next();
  }
  return res.status(401).json({ error: "unauthorized" });
};

const app = express();
app.use(express.json({ limit: "4mb" }));

// Health endpoint — required by compose depends_on and K8s probes
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/v1/roster", (_req, res) => {
  const raw = process.env.RANDOM_AGENT_COUNT;
  const parsed = raw !== undefined && raw.trim() !== "" ? parseInt(raw, 10) : NaN;
  const count = Math.max(0, Number.isFinite(parsed) ? parsed : 10);
  const roster = Array.from({ length: count }, (_, i) => ({
    characterId: `wanderer-${i + 1}`,
    displayName: `Wanderer ${i + 1}`,
  }));
  res.json(roster);
});

app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(
  "/a2a/jsonrpc",
  requireToken,
  jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
);

async function register(): Promise<void> {
  if (!agentHostUrl) {
    console.warn(JSON.stringify({ kind: "random-agent.registration-skipped", reason: "AGENT_HOST_URL not set" }));
    return;
  }

  const deadline = Date.now() + registerTimeoutMs;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Deregister any stale entry before registering — ignore 404; warn on 409 (active sessions)
  try {
    const del = await fetch(`${agentHostUrl}/v1/catalog/${agentId}`, { method: "DELETE", headers });
    if (del.status === 409) {
      console.warn(JSON.stringify({ kind: "random-agent.deregister-conflict", agentId, note: "active sessions; skipping deregister" }));
    }
  } catch {
    // network error during delete — continue to registration attempt
  }

  for (;;) {
    try {
      const res = await fetch(`${agentHostUrl}/v1/catalog/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId, baseUrl: publicBase }),
      });
      if (res.ok || res.status === 201) {
        log.info({ kind: "registered", agentId });
        return;
      }
      if (res.status === 409) {
        // Already registered (race or restart without clean deregister) — treat as success
        console.warn(JSON.stringify({ kind: "random-agent.already-registered", agentId }));
        return;
      }
      // 4xx client error that isn't 409 — unlikely to recover, fall through to retry
      console.warn(JSON.stringify({ kind: "random-agent.registration-error", status: res.status }));
    } catch (err) {
      // network error — agent-host not yet ready
    }

    if (Date.now() >= deadline) {
      console.error(JSON.stringify({ kind: "random-agent.registration-timeout", agentId }));
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
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

app.listen(port, "0.0.0.0", () => {
  log.info({ kind: "start", publicBase, port, agentId });
  // Registration runs after listen — non-blocking relative to accepting connections
  register();
});
