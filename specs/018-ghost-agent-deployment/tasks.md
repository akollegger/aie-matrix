# Tasks: Ghost Agent Deployment (018)

**Input**: Design documents from `/specs/018-ghost-agent-deployment/`  
**Prerequisites**: plan.md ✓ · spec.md ✓ · research.md ✓ · data-model.md ✓ · quickstart.md ✓

**Tests**: Smoke-test tasks included at each tier boundary per Constitution Principle III.

**Organization**: Tasks are grouped by user story to enable independent testing at each tier.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in the same phase)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: Verify build baseline and create env var documentation before any code changes.

- [x] T001 Verify `pnpm build` succeeds in `ghosts/random-agent/` from a clean state (establishes working baseline)
- [x] T002 [P] Create `ghosts/random-agent/.env.example` documenting: `AGENT_HOST_URL`, `AGENT_HOST_TOKEN`, `RANDOM_AGENT_PUBLIC_BASE_URL`, `AGENT_PORT`, `AGENT_REGISTER_TIMEOUT`

---

## Phase 2: Foundational — Health Endpoint

**Purpose**: `/health` is required by compose `depends_on`, K8s probes, and the e2e test. MUST be complete before US2 (compose) and US3 (K8s).

**⚠️ CRITICAL**: US2 and US3 cannot be completed without this phase.

- [x] T003 Add `GET /health` route to `ghosts/random-agent/src/agent.ts` returning `{ "status": "ok" }` (HTTP 200); mount before A2A routes
- [x] T004 Smoke-test health endpoint: start `pnpm dev` in `ghosts/random-agent/`, run `curl http://localhost:4001/health` → `{"status":"ok"}`

**Checkpoint**: Health endpoint serving — US2 and US3 can now be implemented.

---

## Phase 3: User Story 1 — Local Run (Priority: P1) 🎯 MVP

**Goal**: A developer runs `pnpm dev` in `ghosts/random-agent/` and the ghost self-registers with a running local agent-host within 30 seconds.

**Independent test**: With agent-host running locally, `pnpm dev` → `curl http://localhost:4000/v1/catalog` shows `random-agent-<hostname>` with tier "wanderer". Ctrl-C → entry removed within 30s.

- [x] T005 [US1] Add `AGENT_HOST_URL` env var read to `ghosts/random-agent/src/agent.ts` (alongside existing `AGENT_HOST_TOKEN`, `AGENT_PORT`, `RANDOM_AGENT_PUBLIC_BASE_URL`)
- [x] T006 [US1] Add `agentId` derivation to `ghosts/random-agent/src/agent.ts`: `const agentId = \`random-agent-\${process.env.HOSTNAME ?? "local"}\``
- [x] T007 [US1] Implement startup registration in `ghosts/random-agent/src/agent.ts` (call after `app.listen` callback fires):
  - `DELETE ${AGENT_HOST_URL}/v1/catalog/${agentId}` with bearer — ignore 404; on 409 log warning and skip
  - `POST ${AGENT_HOST_URL}/v1/catalog/register` with `{ agentId, baseUrl: publicBase }` and bearer
  - Retry on network error / 5xx every 2s up to `AGENT_REGISTER_TIMEOUT` (default 120 000 ms)
  - Log `{ kind: "random-agent.registered", agentId }` on success; `{ kind: "random-agent.registration-timeout" }` and `process.exit(1)` on timeout
- [x] T008 [US1] Add SIGTERM handler to `ghosts/random-agent/src/agent.ts`: call `DELETE /v1/catalog/${agentId}` (ignore errors), then exit 0 within 10s
- [x] T009 [US1] Smoke-test US1 per `specs/018-ghost-agent-deployment/quickstart.md` §Tier 1, steps 1–4

---

## Phase 4: User Story 2 — Compose Stack (Priority: P1)

**Goal**: `docker compose up` starts the full stack including a `random-agent` container that self-registers and is ready to spawn ghosts.

**Depends on**: Phase 2 (health endpoint), Phase 3 (registration code)

**Independent test**: `docker compose -f deploy/staging/docker-compose.yml up --build` → all services healthy within 5 min; `curl http://localhost:4000/v1/catalog` shows random-agent entry.

- [x] T010 [US2] Create `ghosts/random-agent/Dockerfile` using agent-host three-stage pattern (base → build → runner); build filter chain: `@aie-matrix/root-env` → `@aie-matrix/shared-types` → `@aie-matrix/ghost-ts-client` → `@aie-matrix/random-agent`; CMD: `node dist/agent.js`; EXPOSE 4001
- [x] T011 [US2] Add `random-agent` service to `deploy/staging/docker-compose.yml`:
  - `build: { context: ../, dockerfile: ghosts/random-agent/Dockerfile }`
  - `depends_on: agent-host: condition: service_healthy`
  - `environment`: `AGENT_HOST_URL=http://agent-host:4000`, `AGENT_HOST_TOKEN`, `RANDOM_AGENT_PUBLIC_BASE_URL`, `AGENT_PORT=4001`
  - `networks: [aie-matrix]`
  - `healthcheck`: node-based (node:24-slim has no curl); `interval: 10s`, `start_period: 30s`, `retries: 5`
- [x] T012 [P] [US2] Add `RANDOM_AGENT_PUBLIC_BASE_URL=http://random-agent:4001` to `deploy/staging/.env.staging.example` with inline comment explaining compose-network URL
- [ ] T013 [US2] Smoke-test US2 per `specs/018-ghost-agent-deployment/quickstart.md` §Tier 2, steps 1–4

---

## Phase 5: User Story 3 — Kubernetes Deployment (Priority: P2)

**Goal**: `kubectl apply -f deploy/k8s/ghosts/random-agent.yaml` produces a Ready pod that self-registers in the agent-host catalog. Scaling to 3 replicas produces 3 distinct catalog entries.

**Depends on**: Phase 4 (Dockerfile must produce a pushable image)

**Independent test**: Apply manifest → `kubectl rollout status deployment/random-agent` Ready; `curl $(kubectl get svc agent-host -o jsonpath='{.spec.clusterIP}')/v1/catalog` shows `random-agent-<pod-name>`.

- [x] T014 [US3] Create `deploy/k8s/ghosts/random-agent.yaml` with:
  - `Deployment`: 1 replica, image tag from `$IMAGE_TAG`
  - `env`: `AGENT_HOST_URL` (ClusterIP of agent-host Service), `AGENT_HOST_TOKEN` from Secret `agent-host-token`, `AGENT_PORT=4001`
  - `env.RANDOM_AGENT_PUBLIC_BASE_URL` via downward API: `$(MY_POD_IP):4001` where `MY_POD_IP` comes from `fieldRef: fieldPath: status.podIP`
  - `env.HOSTNAME` from `fieldRef: fieldPath: metadata.name` (pod name → unique agentId)
  - Readiness probe: `GET /health`, `initialDelaySeconds: 15`, `periodSeconds: 10`
  - Liveness probe: `GET /health`, `initialDelaySeconds: 30`, `periodSeconds: 30`
  - Resource requests: `cpu: 100m, memory: 128Mi`
- [x] T015 [P] [US3] Create `deploy/k8s/secrets/agent-host-token.yaml.example` (K8s Secret template for `AGENT_HOST_TOKEN`; base64-encoded placeholder; gitignored pattern documented)
- [x] T016 [US3] Validate manifest: `kubectl apply --dry-run=client -f deploy/k8s/ghosts/random-agent.yaml` passes with no errors

---

## Phase 6: User Story 4 — Template Guide (Priority: P3)

**Goal**: A developer adds `ghosts/observer-agent/` following `ghosts/README.md` without reading any other document.

**Independent of**: US1–US3 code (documentation only; can be written in parallel after US1 is understood)

**Independent test**: A contributor unfamiliar with the spec follows `ghosts/README.md` top-to-bottom and has a new ghost running in compose.

- [x] T017 [US4] Create `ghosts/README.md` covering: what a first-party ghost needs (A2A server, `/health`, registration loop, SIGTERM deregistration); env var contract table; step-by-step: copy Dockerfile → change pnpm filter; add service to docker-compose.yml (copy random-agent block); add K8s manifest; point to quickstart.md for verification
- [x] T018 [US4] Update `CONTRIBUTING.md`: add "Contributing a ghost agent" section linking to `ghosts/README.md`

---

## Final Phase: Documentation & Cross-Cutting

- [x] T019 Update `docs/architecture.md`: revise "Ghost house" section to note first-party ghosts are containerized per ADR-0009; add `random-agent` to the component diagram north-south links table
- [x] T020 [P] Update `deploy/staging/README.md`: add ghost agent startup notes (env vars, expected catalog entry, how to trigger spawn)
- [x] T021 [P] Run `pnpm typecheck` in `ghosts/random-agent/` and confirm no new errors introduced by Phase 3 changes

---

## Dependencies

```
T001 T002
  │
  ▼
T003 → T004 (health smoke-test)
  │
  ▼
T005 → T006 → T007 → T008 → T009 (US1 smoke-test)
                                │
                                ▼
              T010 → T011 → T012 → T013 (US2 smoke-test)
                                │
                                ▼
                    T014 → T015 → T016 (US3 dry-run)

T017 → T018  (US4 — parallel after T009 is understood)
T019 T020 T021  (final — parallel, after US2 complete)
```

## Parallel Execution

**Within US1** (Phase 3): T005, T006, T008 touch different parts of `agent.ts` and can be drafted in parallel, but T007 (registration) depends on T005 (AGENT_HOST_URL) and T006 (agentId) being wired first. T009 depends on T007+T008.

**US2 vs US4**: T017–T018 (README) can be drafted while T010–T013 (compose) are being implemented since they document the same pattern.

**Final phase**: T019, T020, T021 are fully independent and can all run in parallel.

## Implementation Strategy

**MVP scope**: Phase 1 + Phase 2 + Phase 3 (US1) — produces a self-registering ghost running locally. This is the minimum needed to validate the registration contract end-to-end before building the container layer.

**Suggested order**:
1. T001–T004 (setup + health) — ~30 min
2. T005–T009 (US1, local registration) — ~1 hour
3. T010–T013 (US2, compose) — ~1 hour
4. T017–T018 (US4, guide) — ~30 min, can overlap with US2
5. T014–T016 (US3, K8s) — ~45 min
6. T019–T021 (polish) — ~30 min

**Total**: ~21 tasks · ~4 hours estimated
