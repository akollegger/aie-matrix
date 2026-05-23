# `ghosts/` — First-Party Ghost Agents

First-party ghosts are autonomous agents that self-register with the **agent-host** on startup, respond to A2A spawn requests, and interact with the world via MCP. They are deployed as containers alongside the rest of the stack (ADR-0009).

The reference implementation is **`random-agent/`** (Wanderer tier).

## Packages

| Path | Package | Role |
|------|---------|------|
| [`random-agent/`](./random-agent/) | `@aie-matrix/random-agent` | Reference Wanderer — random movement via MCP |
| [`ts-client/`](./ts-client/) | `@aie-matrix/ghost-ts-client` | MCP client SDK used by ghost implementations |
| [`tck/`](./tck/) | `@aie-matrix/ghost-tck` | Compatibility smoke tests — server must be running |

---

## What a first-party ghost needs

Every ghost is a Node.js HTTP server that:

1. **Serves an A2A agent card** at `GET /.well-known/agent-card.json` (IC-001 schema; `matrix` block required)
2. **Exposes `GET /health`** returning `{ "status": "ok" }` (used by compose and K8s probes)
3. **Self-registers on startup** — calls `POST {AGENT_HOST_URL}/v1/catalog/register` after `listen()`
4. **Deregisters on SIGTERM** — calls `DELETE {AGENT_HOST_URL}/v1/catalog/{agentId}` before exiting

## Environment variable contract

Every ghost reads these variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `AGENT_HOST_URL` | yes | — | Base URL of the agent-host (`http://agent-host:4000` in compose, ClusterIP in K8s) |
| `AGENT_HOST_TOKEN` | yes | — | Shared bearer token — must match agent-host's `AGENT_HOST_TOKEN` |
| `AGENT_PORT` | no | `4001` | Port this ghost listens on |
| `<NAME>_PUBLIC_BASE_URL` | yes | `http://127.0.0.1:${AGENT_PORT}` | Externally reachable base URL used in catalog registration and the agent card |
| `AGENT_REGISTER_TIMEOUT` | no | `120000` ms | Max wait before exiting if registration fails |

Agent ID is derived as: `<ghost-name>-${HOSTNAME ?? "local"}`. In K8s, `HOSTNAME` is the pod name (set automatically), making each replica's catalog entry unique.

---

## Spawning a ghost

The preferred way to spawn ghosts in production or staging is through the **Admin panel** at `admin.matrix.relateby.dev` (or `http://localhost:5173` locally in Admin mode). The panel handles the full spawn flow automatically:

1. Open the Admin panel → click a running world session in the left sidebar
2. The Catalog panel opens — showing all registered agents
3. Click **Spawn Ghost** on any agent row
4. The panel acquires a ghost identity from the registry and spawns the ghost in one step

No terminal access or curl commands required. See `specs/019-ghost-management/quickstart.md` for local setup.

For manual spawning via curl (CI, scripting, or when the admin panel is unavailable), see `specs/018-ghost-agent-deployment/quickstart.md` §Tier 1.

---

## Adding a new ghost

### Step 1 — Copy the reference implementation

```bash
cp -r ghosts/random-agent ghosts/my-agent
cd ghosts/my-agent
# edit package.json: change "name" to "@aie-matrix/my-agent"
# edit src/agent.ts: change agentId prefix, implement your executor
# edit src/buildAgentCard.ts: set your agent's name, description, and tier
```

### Step 2 — Update the Dockerfile

In `ghosts/my-agent/Dockerfile`, change only the pnpm filter lines:

```dockerfile
# Change random-agent → my-agent in these two lines:
RUN pnpm --filter @aie-matrix/my-agent run build
RUN pnpm --filter @aie-matrix/my-agent deploy --prod --legacy /app/deploy
```

Keep the base stage and runner stage identical to `random-agent/Dockerfile`.

### Step 3 — Add to pnpm-workspace.yaml

```yaml
# pnpm-workspace.yaml
packages:
  - ghosts/my-agent
  # ... existing entries
```

### Step 4 — Add to docker-compose.yml

Copy the `random-agent` service block in `deploy/staging/docker-compose.yml` and change:
- service name: `random-agent` → `my-agent`
- `dockerfile`: `ghosts/random-agent/Dockerfile` → `ghosts/my-agent/Dockerfile`
- env var name: `RANDOM_AGENT_PUBLIC_BASE_URL` → `MY_AGENT_PUBLIC_BASE_URL`
- `AGENT_HOST_URL` value: keep `http://agent-host:4000`
- port: pick a new port (e.g. `4002:4002`)

Add `MY_AGENT_PUBLIC_BASE_URL=http://my-agent:<port>` to `.env.staging.example`.

### Step 5 — Add a K8s manifest

Copy `deploy/k8s/ghosts/random-agent.yaml` → `deploy/k8s/ghosts/my-agent.yaml` and change:
- All `random-agent` name references to `my-agent`
- The image name to match your new package
- The `<NAME>_PUBLIC_BASE_URL` env var name

### Step 6 — Verify

Follow `specs/018-ghost-agent-deployment/quickstart.md` to verify registration and spawn at each tier.

---

## Related

- [ADR-0009](../proposals/adr/0009-first-party-ghost-deployment.md) — why first-party deployment for AIEWF 2026
- [ADR-0004](../proposals/adr/0004-ghost-agent-tiers.md) — Wanderer / Listener / Social behavioral tiers
- [Spec 018 quickstart](../specs/018-ghost-agent-deployment/quickstart.md) — local run, compose, K8s verification
- [RFC-0007](../proposals/rfc/0007-a2a-agent-host.md) — A2A agent-host architecture
