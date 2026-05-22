# Implementation Plan: Ghost Agent Deployment (018)

**Branch**: `018-ghost-agent-deployment` | **Date**: 2026-05-22 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/018-ghost-agent-deployment/spec.md`

## Summary

Add self-registration, health endpoint, and graceful shutdown to `ghosts/random-agent/`, then containerize it following the `server/agent-host/Dockerfile` pattern, extend the staging compose stack, add K8s manifests, and write a `ghosts/README.md` template guide. The ghost registers itself with the agent-host catalog on startup using `AGENT_HOST_URL` and `RANDOM_AGENT_PUBLIC_BASE_URL`, handles the restart/idempotency case by deregistering before re-registering, and cleans up on SIGTERM.

## Technical Context

**Language/Version**: TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`)  
**Primary Dependencies**: `express` v4, `@a2a-js/sdk` 0.3.13+, `@aie-matrix/root-env`, `@aie-matrix/ghost-ts-client` (workspace); Docker/Podman multi-stage build; Kubernetes 1.28+  
**Storage**: `catalog.json` on agent-host (no new storage owned by ghost)  
**Testing**: vitest (unit, existing); Playwright e2e (already migrated to agent-host + random-agent in `e2e/tests/spectator-ghosts.spec.ts`)  
**Target Platform**: Node.js 24 container; Podman compose (local Tier 2); GKE (Tier 3)  
**Project Type**: service (containerized ghost agent)  
**Performance Goals**: Self-registers within 30s of startup; ghost movement visible in Colyseus within 60s of spawn  
**Constraints**: No new npm deps in ghost packages; multi-stage Dockerfile copies only `dist/` + production deps; health endpoint < 1s response  
**Scale/Scope**: 1 instance for Tier 1/2; 1–3 K8s replicas for staging

## Constitution Check

**Principle I (Proposal-First):** ✅ ADR-0009 records the first-party ghost decision; this spec implements it. ADR-0007 covers three-tier deployment; Spec 016 establishes the Dockerfile/compose pattern.

**Principle II (Boundary-Preserving):** ✅ Ghost communicates with agent-host via HTTP only (`POST /v1/catalog/register`, `DELETE /v1/catalog/:agentId`). No direct Colyseus or Neo4j access. No in-process embedding in agent-host.

**Principle III (Verifiable Increments):** ✅ US1 (local run), US2 (compose), US3 (K8s), US4 (second ghost) each have independent acceptance tests. E2e test already updated.

**Principle IV (Contract-Explicit):** ✅ IC-001 through IC-004 in spec.md; `POST /v1/catalog/register` and `DELETE /v1/catalog/:agentId` are existing agent-host contracts. No new cross-package interfaces introduced.

**Principle V (Contribution Hygiene):** ✅ `ghosts/README.md` documents the repeatable pattern; `CONTRIBUTING.md` update is listed as a deliverable.

No constitution violations. No complexity tracking required.

## Project Structure

### Documentation (this feature)

```text
specs/018-ghost-agent-deployment/
├── plan.md         ← this file
├── research.md     ✓ generated
├── data-model.md   ✓ generated
├── quickstart.md   ✓ generated
└── contracts/      N/A — contracts are the existing agent-host HTTP API (IC-001–004 in spec.md)
```

### Source Code

```text
ghosts/random-agent/
├── src/
│   └── agent.ts          ← modify: add /health, startup registration, SIGTERM handler
├── Dockerfile             ← new
└── .env.example           ← new (AGENT_HOST_URL, RANDOM_AGENT_PUBLIC_BASE_URL, AGENT_HOST_TOKEN, AGENT_PORT)

deploy/staging/
├── docker-compose.yml     ← extend: add random-agent service
└── .env.staging.example   ← extend: add RANDOM_AGENT_PUBLIC_BASE_URL

deploy/k8s/ghosts/
└── random-agent.yaml      ← new: Deployment + readiness/liveness probes

deploy/k8s/secrets/
└── agent-host-token.yaml.example  ← new: K8s Secret template

ghosts/
└── README.md              ← new: repeatable "add a ghost" guide

CONTRIBUTING.md            ← extend: link to ghosts/README.md
```

**Structure Decision**: Modifying `ghosts/random-agent/` in place (no new top-level directory). K8s manifests land in `deploy/k8s/ghosts/` consistent with `deploy/k8s/charts/` for the existing services.

## Implementation Phases

### Phase A — Tier 1: local run (US1)

Modify `ghosts/random-agent/src/agent.ts`:

1. Add `GET /health` route returning `{ status: "ok" }` (200).
2. Add `AGENT_HOST_URL` env var read (alongside existing `AGENT_HOST_TOKEN`, `AGENT_PORT`, `RANDOM_AGENT_PUBLIC_BASE_URL`).
3. Derive `agentId` as `random-agent-${process.env.HOSTNAME ?? "local"}`.
4. On startup (after `app.listen` callback): run registration loop:
   - `DELETE ${AGENT_HOST_URL}/v1/catalog/${agentId}` — ignore 404; on 409, log warning and skip.
   - `POST ${AGENT_HOST_URL}/v1/catalog/register` with `{ agentId, baseUrl: publicBase }` and `Authorization: Bearer ${AGENT_HOST_TOKEN}`.
   - Retry every 2s up to `AGENT_REGISTER_TIMEOUT` (default 120s) on network errors or 5xx.
5. On `process.on("SIGTERM")`: call `DELETE /v1/catalog/${agentId}`, then exit 0 within 10s.

Create `ghosts/random-agent/.env.example` documenting all env vars.

**Acceptance**: `pnpm dev` in `ghosts/random-agent/` with local stack up → ghost appears in `GET /v1/catalog` within 30s.

---

### Phase B — Tier 2: compose (US2)

Create `ghosts/random-agent/Dockerfile` (copy agent-host pattern, change filters):

```
root-env → shared-types → ghost-ts-client → random-agent
```

Final CMD: `node dist/agent.js`

Extend `deploy/staging/docker-compose.yml`:
- New service `random-agent` after `agent-host`.
- `depends_on: agent-host: condition: service_healthy`.
- Health check: `curl -f http://localhost:4001/health` with 30s `start_period`.
- Env: `AGENT_HOST_TOKEN`, `AGENT_HOST_URL=http://agent-host:4000`, `RANDOM_AGENT_PUBLIC_BASE_URL` (from env file), `AGENT_PORT=4001`.

Extend `deploy/staging/.env.staging.example` with `RANDOM_AGENT_PUBLIC_BASE_URL`.

**Acceptance**: `docker compose up` → all services + `random-agent` healthy within 5 min; ghost in catalog.

---

### Phase C — Tier 3: K8s (US3)

Create `deploy/k8s/ghosts/random-agent.yaml`:
- `Deployment` with 1 replica (scalable).
- `AGENT_HOST_URL` pointing to agent-host ClusterIP Service.
- `AGENT_HOST_TOKEN` from K8s Secret.
- `RANDOM_AGENT_PUBLIC_BASE_URL` = pod IP or headless service DNS (use `$(MY_POD_IP)` downward API or headless service).
- Readiness probe: `GET /health`, initialDelaySeconds: 15.
- Liveness probe: `GET /health`, periodSeconds: 30.

Create `deploy/k8s/secrets/agent-host-token.yaml.example`.

**Acceptance**: `kubectl apply` → pod Ready within 60s; catalog registration visible.

---

### Phase D — Template guide (US4)

Create `ghosts/README.md` documenting:
1. What a first-party ghost needs (A2A server, `/health`, registration on startup, deregistration on SIGTERM).
2. Env vars contract (`AGENT_HOST_URL`, `RANDOM_AGENT_PUBLIC_BASE_URL` / `<AGENT>_PUBLIC_BASE_URL`, `AGENT_HOST_TOKEN`, `AGENT_PORT`).
3. Copy `random-agent/Dockerfile` and change the pnpm filter.
4. Add service to `docker-compose.yml` — copy the `random-agent` block.
5. Add K8s manifest — copy `deploy/k8s/ghosts/random-agent.yaml`.

Update `CONTRIBUTING.md` to link to `ghosts/README.md`.

**Acceptance**: `ghosts/observer-agent/` can be brought up in compose following the guide without reading any other doc.
