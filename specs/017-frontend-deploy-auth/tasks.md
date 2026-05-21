# Tasks: Frontend Deployment and Auth

**Input**: Design documents from `specs/017-frontend-deploy-auth/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

> This feature is **infrastructure-only** — no application code changes in front-end packages. All tasks produce either GCP resource configurations, gcloud CLI runbooks, or CI/CD workflow additions.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (no shared resource or file conflict)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: Establish the deploy/frontend/ runbook directory and document the IAP verification gate before any GCP resources are created.

- [x] T001 Create `deploy/frontend/` directory and stub `deploy/frontend/README.md` with section headings (Prerequisites, Phase order, IAP verification, Resources, Runbook)
- [x] T002 Document IAP-on-backend-bucket verification step in `deploy/frontend/README.md` — gcloud command to test, expected success output, and Cloud Run fallback procedure (per research.md Finding 1)
- [x] T003 [P] Add `deploy/frontend/url-map.yaml` with **intermedium-only** host-rule skeleton: `play.matrix.relateby.dev` → `intermedium-backend` (admin host rule is added in T019 once `admin-backend` exists; importing a URL map that references a non-existent backend fails)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: GCS buckets, static IP, and CI service account permissions that MUST exist before US1 or US2 can be provisioned.

**⚠️ CRITICAL**: No user story infrastructure can be provisioned until this phase is complete.

- [x] T004 Reserve second global static IP `aie-matrix-frontend` (separate from the GKE Ingress IP); record the address in `deploy/frontend/README.md`
- [x] T005 [P] Create `gs://aie-matrix-intermedium` GCS bucket (us-central1, uniform access) and grant `allUsers roles/storage.objectViewer` — document command in `deploy/frontend/README.md`
- [x] T006 [P] Create `gs://aie-matrix-admin` GCS bucket (us-central1, uniform access, no public access) — document command in `deploy/frontend/README.md`
- [x] T007 Grant the CI service account (`GCP_SERVICE_ACCOUNT` secret) `roles/storage.objectAdmin` on both new buckets — document command in `deploy/frontend/README.md`
- [x] T008 Add `VITE_API_BASE_URL` secret (`https://matrix.relateby.dev`) to the GitHub Actions repository secrets; document the secret name in `deploy/frontend/README.md`

**Checkpoint**: Both GCS buckets exist, static IP is reserved, CI SA can write to buckets, `VITE_API_BASE_URL` secret is available. ✅

---

## Phase 3: User Story 1 — Spectator Views the World (Priority: P1) 🎯 MVP

**Goal**: `https://play.matrix.relateby.dev` serves the Intermedium SPA publicly via Cloud CDN with no authentication.

**Independent Test**: Open `https://play.matrix.relateby.dev` in a private browser window (no cookies). The deck.gl scene loads without any login redirect.

### Implementation

- [x] T009 [US1] Create GCP backend bucket resource `intermedium-backend` pointing at `gs://aie-matrix-intermedium` with Cloud CDN enabled — document gcloud command in `deploy/frontend/README.md`
- [x] T010 [US1] Create URL map `aie-matrix-frontend` with `play.matrix.relateby.dev` host rule routing to `intermedium-backend`; import from `deploy/frontend/url-map.yaml`
- [x] T011 [US1] Create Google-managed TLS certificate `aie-matrix-frontend-cert` covering **both** `play.matrix.relateby.dev` and `admin.matrix.relateby.dev` — Google-managed certs are immutable after creation; provision both subdomains now even though `admin-backend` does not exist until Phase 4; document command in `deploy/frontend/README.md`
- [x] T012 [US1] Create HTTPS target proxy `aie-matrix-frontend-proxy` referencing the URL map and cert; create global forwarding rule on port 443 pointing at `aie-matrix-frontend` static IP — document in `deploy/frontend/README.md`
- [x] T013 [US1] Add DNS A record `play.matrix.relateby.dev` → `aie-matrix-frontend` static IP; document in `deploy/frontend/README.md` (manual step — script prints IP)
- [ ] T014 [US1] Smoke test: navigate to `https://play.matrix.relateby.dev` in a private browser; confirm Intermedium loads with no auth prompt; record result in `deploy/frontend/README.md` under Verification

**Checkpoint**: Intermedium is publicly reachable via CDN. US1 acceptance scenarios pass. ✅

---

## Phase 4: User Story 2 — Operator Accesses the Admin Client (Priority: P1)

**Goal**: `https://admin.matrix.relateby.dev` serves the Admin SPA; unauthenticated requests redirect to Google OAuth; unauthorized accounts receive 403.

**Independent Test**: Open `https://admin.matrix.relateby.dev` in a private browser. Confirm Google OAuth redirect occurs. Confirm authorized account reaches the Admin UI. Confirm unauthorized account receives 403.

### Implementation

- [x] T015 [US2] **IAP verification gate**: run `gcloud compute backend-buckets update admin-backend --iap=enabled,...` against a test backend bucket; confirm command succeeds or triggers fallback path (Cloud Run nginx:alpine) — record the chosen implementation path ("backend-bucket IAP" or "Cloud Run fallback") in a **"Chosen IAP Implementation"** section in `deploy/frontend/README.md` before proceeding to T016
- [x] T016 [US2] Create GCP backend bucket resource `admin-backend` (IAP path) **OR** Cloud Run service `admin-frontend` serving `gs://aie-matrix-admin` via nginx (fallback path) per the decision recorded in T015 — document chosen approach in `deploy/frontend/README.md`
- [x] T017 [US2] Configure IAP OAuth consent screen (Internal, GCP org) and create OAuth client ID in the GCP project — document one-time setup steps in `deploy/frontend/README.md`
- [x] T018 [US2] Enable IAP on `admin-backend` (or Cloud Run backend) using OAuth credentials from T017 — document command in `deploy/frontend/README.md`
- [x] T019 [US2] Add `admin.matrix.relateby.dev` host rule to URL map `aie-matrix-frontend` pointing at `admin-backend` — update `deploy/frontend/url-map.yaml` to add the admin host rule and re-import (cert already covers `admin.*` from T011; no cert update needed)
- [x] T020 [US2] Add DNS A record `admin.matrix.relateby.dev` → same `aie-matrix-frontend` static IP — document in `deploy/frontend/README.md`
- [ ] T021 [US2] Add initial `roles/iap.httpsResourceAccessor` IAM binding for at least one operator account; document the add/remove commands in `deploy/frontend/README.md` and confirm they match `specs/017-frontend-deploy-auth/quickstart.md`
- [x] T022 [US2] Verify `name` fields in `clients/intermedium/package.json` and `tools/map-editor/package.json`; record the correct pnpm filter expressions to use in T024 (prefer `--filter ./clients/intermedium` directory form over package name to avoid silent mismatches)
- [ ] T023 [US2] Smoke test: verify IAP redirect (unauthorized private browser), authorized login lands on Admin UI, unauthorized login receives 403 — record results in `deploy/frontend/README.md` under Verification

**Checkpoint**: Admin is IAP-gated. US2 acceptance scenarios pass. ✅

---

## Phase 5: User Story 3 — CI/CD Deploys a New Build (Priority: P2)

**Goal**: Pushing a `v*` tag triggers automated build of both front-ends, syncs artifacts to GCS, and invalidates the Intermedium CDN cache. No manual `gsutil` steps required.

**Independent Test**: Push a test tag. Confirm the `production-deploy.yml` workflow adds front-end build/sync/invalidate steps and they complete without error. Confirm updated artifacts are live at the production URLs.

### Implementation

- [x] T024 [US3] Add `build-deploy-frontend` job to `.github/workflows/production-deploy.yml` — job runs after GCP auth is established; builds using `pnpm --filter ./clients/intermedium build` and `pnpm --filter ./tools/map-editor build` (directory form, not package name, per T022 finding) with `VITE_API_BASE_URL` injected from secrets; fails explicitly if `VITE_API_BASE_URL` is unset
- [x] T025 [P] [US3] Add `gsutil -m rsync -r -d clients/intermedium/dist/ gs://aie-matrix-intermedium/` step to the new job in `.github/workflows/production-deploy.yml`
- [x] T026 [P] [US3] Add `gsutil -m rsync -r -d tools/map-editor/dist/ gs://aie-matrix-admin/` step to the new job in `.github/workflows/production-deploy.yml`
- [x] T027 [US3] Add `gcloud compute url-maps invalidate-cdn-cache aie-matrix-frontend --path "/*" --host play.matrix.relateby.dev --async` step (after T025) in `.github/workflows/production-deploy.yml`
- [ ] T028 [US3] Smoke test: push a version tag; confirm the workflow completes and updated builds are live at both production URLs

**Checkpoint**: Front-end deploys are fully automated. US3 acceptance scenarios pass. ✅

---

## Phase 6: User Story 4 — Onboarding a New Operator (Priority: P3)

**Goal**: A GCP project admin can grant or revoke Admin access for any Google account via a single `gcloud` command with no code change or redeployment.

**Independent Test**: Add a new Google account to the IAP binding. Confirm access within 60 seconds. Remove the binding. Confirm denial without redeployment.

### Implementation

- [ ] T029 [US4] Verify `add-iam-policy-binding` and `remove-iam-policy-binding` commands documented in `specs/017-frontend-deploy-auth/quickstart.md` work end-to-end against the live IAP resource; update the quickstart if any command details differ
- [ ] T030 [US4] Add a "Operator Access Management" section to `deploy/frontend/README.md` mirroring the quickstart commands, with notes on propagation time (~60 seconds) and that no redeployment is required

**Checkpoint**: Operator onboarding requires no code changes. US4 acceptance scenarios pass. ✅

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation updates, helper script, and full end-to-end smoke test across all stories.

- [x] T031 [P] Update `docs/architecture.md` — add entries to the Decided Stack table for front-end hosting (GCS + Cloud CDN) and Admin access control (IAP); note that the Authentication and Identity open question is partially resolved for the operator use case
- [x] T032 [P] Update `deploy/staging/README.md` — add "Front-end validation" section documenting `pnpm preview` commands for Intermedium and Admin with `VITE_API_BASE_URL` set to the staging host (per `specs/017-frontend-deploy-auth/quickstart.md`)
- [x] T033 Create `deploy/frontend/setup.sh` — idempotent shell script wrapping the gcloud commands from `deploy/frontend/README.md` in correct dependency order (IP → buckets → backend resources → IAP verify → URL map → cert → proxy → forwarding rule → DNS reminder → SA permissions)
- [ ] T034 Run full end-to-end smoke test across all user stories using `specs/017-frontend-deploy-auth/quickstart.md` as the checklist; confirm all four stories pass in a single session

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — can start once buckets + IP exist
- **Phase 4 (US2)**: Depends on Phase 2 + Phase 3 complete (URL map must exist before admin host rule is added)
- **Phase 5 (US3)**: Depends on Phase 2 (GCS buckets + secret must exist for CI to succeed); independent of Phase 3/4 timing
- **Phase 6 (US4)**: Depends on Phase 4 (IAP resource must exist)
- **Phase 7 (Polish)**: Depends on all user story phases

### User Story Dependencies

| Story | Depends On | Can Parallelize With |
|-------|-----------|----------------------|
| US1 (P1) | Phase 2 | US3 CI/CD prep |
| US2 (P1) | Phase 2, US1 (URL map) | US3 CI/CD prep |
| US3 (P2) | Phase 2 (buckets + secret) | US1, US2 infra |
| US4 (P3) | US2 (IAP resource) | US3, Polish |

### Within Each Phase

- GCS bucket creation tasks (T005, T006) can run in parallel
- URL map, cert, proxy, and DNS tasks within US1 must run in the order listed (map before proxy, cert before proxy, proxy before forwarding rule)
- CI/CD sync steps (T025, T026) can run in parallel within the same job

---

## Parallel Execution Example: Phase 2 (Foundational)

```bash
# These three can run in parallel (different GCP resources):
T005: Create gs://aie-matrix-intermedium
T006: Create gs://aie-matrix-admin
T007: Grant CI SA permissions (can run once buckets exist)
T008: Add VITE_API_BASE_URL secret (independent of GCP resources)
```

## Parallel Execution Example: Phase 5 (CI/CD)

```bash
# Within production-deploy.yml build-deploy-frontend job:
# After builds complete, these sync steps can run in parallel:
T025: gsutil rsync → gs://aie-matrix-intermedium/
T026: gsutil rsync → gs://aie-matrix-admin/
# T027 (CDN invalidation) must wait for T025 to complete
```

---

## Implementation Strategy

### MVP First (US1 only — public Intermedium serving)

1. Complete Phase 1 (Setup) + Phase 2 (Foundational)
2. Complete Phase 3 (US1) — Intermedium publicly reachable
3. **STOP and VALIDATE**: navigate to `https://play.matrix.relateby.dev` in a private browser
4. Demo the live Intermedium scene to stakeholders

### Incremental Delivery

1. Phase 1 + 2 → Foundation ✅
2. Phase 3 → US1 (Intermedium live) → Demo ✅
3. Phase 4 → US2 (Admin IAP-gated) → Operators can access ✅
4. Phase 5 → US3 (CI/CD automated) → No more manual syncs ✅
5. Phase 6 → US4 (Operator onboarding self-service) ✅
6. Phase 7 → Polish + full smoke test ✅

---

## Notes

- No application code changes — all tasks produce gcloud CLI commands, YAML configs, or CI/CD workflow additions
- T015 (IAP verification) is a hard gate — its outcome determines T016 implementation path (backend bucket vs. Cloud Run)
- GCS bucket names are globally unique — if `aie-matrix-intermedium` or `aie-matrix-admin` are taken, choose an alternative prefix and update all references
- Cert provisioning (T011) takes ~15 minutes after DNS propagates — budget this into the Phase 3 timeline
- `--async` on the CDN invalidation step (T027) means pipeline completion does not guarantee CDN propagation; spectators may see stale `index.html` for up to 5 minutes
