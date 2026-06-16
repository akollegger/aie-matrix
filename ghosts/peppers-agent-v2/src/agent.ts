import { loadRootEnv } from "@aie-matrix/root-env";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import express, { type Request, type RequestHandler, type Response } from "express";
import { buildPeppersAgentCard } from "./buildAgentCard.js";
import { PeppersAgentExecutor } from "./executor.js";

loadRootEnv();

function listenPortFromEnv(fallback: number): number {
  const raw = process.env.PEPPERS_AGENT_PORT;
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : fallback;
}

const dev = process.env.AGENT_HOST_TOKEN ?? "";
const port = listenPortFromEnv(4002);
const publicBase = (
  process.env.PEPPERS_AGENT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`
).replace(/\/$/, "");
// Self-registration target + identity (Spec 018). agentId is stable for a
// single instance; HOSTNAME (container id) keeps replicas distinct.
const agentHostUrl = (process.env.AGENT_HOST_URL ?? "").replace(/\/$/, "");
const agentId =
  process.env.PEPPERS_AGENT_ID ?? process.env.HOSTNAME ?? "peppers-agent";
const registerTimeoutMs = (() => {
  const raw = process.env.AGENT_REGISTER_TIMEOUT;
  if (!raw) return 120_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
})();

const agentCard = buildPeppersAgentCard(publicBase);
const requestHandler = new DefaultRequestHandler(
  agentCard,
  new InMemoryTaskStore(),
  new PeppersAgentExecutor(),
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
// Health endpoint — required by compose depends_on and K8s probes.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: requestHandler }));
app.use(
  "/a2a/jsonrpc",
  requireToken,
  jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }),
);

/**
 * Self-register with the agent-host catalog (Spec 018). The host fetches
 * our agent card from `publicBase/.well-known/agent-card.json` at register
 * time, so our server must already be listening — we call this from the
 * listen callback. Deregisters any stale entry first; retries until the
 * host is reachable or the timeout elapses.
 */
async function register(): Promise<void> {
  if (!agentHostUrl) {
    console.warn(JSON.stringify({ kind: "peppers-agent.registration-skipped", reason: "AGENT_HOST_URL not set" }));
    return;
  }
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${dev}` };
  try {
    const del = await fetch(`${agentHostUrl}/v1/catalog/${agentId}`, { method: "DELETE", headers });
    if (del.status === 409) {
      console.warn(JSON.stringify({ kind: "peppers-agent.deregister-conflict", agentId, note: "active sessions; skipping" }));
    }
  } catch { /* not yet reachable — registration loop handles it */ }

  const deadline = Date.now() + registerTimeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${agentHostUrl}/v1/catalog/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId, baseUrl: publicBase }),
      });
      if (res.ok || res.status === 201) {
        console.info(JSON.stringify({ kind: "peppers-agent.registered", agentId, baseUrl: publicBase }));
        return;
      }
      if (res.status === 409) {
        console.warn(JSON.stringify({ kind: "peppers-agent.already-registered", agentId }));
        return;
      }
      console.warn(JSON.stringify({ kind: "peppers-agent.registration-error", status: res.status, body: (await res.text()).slice(0, 200) }));
    } catch { /* agent-host not ready / can't fetch our card yet — retry */ }
    if (Date.now() >= deadline) {
      console.error(JSON.stringify({ kind: "peppers-agent.registration-timeout", agentId }));
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
      headers: { Authorization: `Bearer ${dev}` },
    });
  } catch { /* best-effort */ }
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    void deregister().finally(() => process.exit(0));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      kind: "peppers-agent.start",
      publicBase,
      port,
      agentId,
      card: `http://127.0.0.1:${port}/.well-known/agent-card.json`,
    }),
  );
  void register();
});
