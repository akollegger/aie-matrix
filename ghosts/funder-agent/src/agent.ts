import { loadRootEnv } from "@aie-matrix/root-env";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import express, { type Request, type RequestHandler, type Response } from "express";
import { buildFunderAgentCard } from "./buildAgentCard.js";
import { FunderExecutor } from "./executor.js";

loadRootEnv();

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
const port = listenPortFromEnv(4002);
const publicBase = (process.env.FUNDER_AGENT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`).replace(
  /\/$/,
  "",
);
const agentId = process.env.HOSTNAME ?? "funder-agent-local";
const registerTimeoutMs = (() => {
  const raw = process.env.AGENT_REGISTER_TIMEOUT;
  if (!raw) return 120_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
})();

const agentCard = buildFunderAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new FunderExecutor(),
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

app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(
  "/a2a/jsonrpc",
  requireToken,
  jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
);

async function register(): Promise<void> {
  if (!agentHostUrl) {
    console.warn(JSON.stringify({ kind: "funder-agent.registration-skipped", reason: "AGENT_HOST_URL not set" }));
    return;
  }

  const deadline = Date.now() + registerTimeoutMs;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Deregister any stale entry before registering
  try {
    const del = await fetch(`${agentHostUrl}/v1/catalog/${agentId}`, { method: "DELETE", headers });
    if (del.status === 409) {
      console.warn(JSON.stringify({ kind: "funder-agent.deregister-conflict", agentId, note: "active sessions; skipping deregister" }));
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
        console.info(JSON.stringify({ kind: "funder-agent.registered", agentId }));
        return;
      }
      if (res.status === 409) {
        console.warn(JSON.stringify({ kind: "funder-agent.already-registered", agentId }));
        return;
      }
      console.warn(JSON.stringify({ kind: "funder-agent.registration-error", status: res.status }));
    } catch {
      // network error — agent-host not yet ready
    }

    if (Date.now() >= deadline) {
      console.error(JSON.stringify({ kind: "funder-agent.registration-timeout", agentId }));
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
  console.info(
    JSON.stringify({
      kind: "funder-agent.start",
      publicBase,
      port,
      agentId,
    }),
  );
  register();
});
