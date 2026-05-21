# Implementation Plan: Frontend Deployment and Auth

**Branch**: `017-frontend-deploy-auth` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/017-frontend-deploy-auth/spec.md`

## Summary

Serve the Intermedium and Admin Vite SPAs from GCS backend buckets behind a new Cloud Load Balancer, with IAP gating the Admin surface and Cloud CDN accelerating the public Intermedium surface. CI/CD is extended in `production-deploy.yml` to build, sync, and invalidate on each `v*` tag push. No application code changes are required in either front-end.

## Technical Context

**Language/Version**: Bash (CI steps); gcloud CLI (infrastructure provisioning)  
**Primary Dependencies**: GCS (static hosting), Cloud Load Balancer (GCLB), Cloud CDN, Identity-Aware Proxy (IAP), GitHub Actions  
**Storage**: Two GCS buckets — `gs://aie-matrix-intermedium` (public), `gs://aie-matrix-admin` (private)  
**Testing**: Manual smoke tests per acceptance scenario (navigate URLs in private browser, check IAP redirect, verify CDN invalidation)  
**Target Platform**: GCP (us-central1), GitHub Actions (CI/CD)  
**Project Type**: Infrastructure configuration + CI/CD pipeline extension  
**Performance Goals**: Intermedium loads under 3 seconds on mobile via CDN edge (SC-001)  
**Constraints**: Zero application code changes in front-end packages; must not disturb the existing GKE Ingress or `matrix.relateby.dev` routing  
**Scale/Scope**: 2 GCS buckets, 1 Cloud Load Balancer (separate from GKE Ingress), 1 IAP resource, additions to 1 GitHub Actions workflow

## Constitution Check

- ✅ **Proposal linkage**: ADR-0008 (`proposals/adr/0008-frontend-deployment-access-control.md`) is accepted and directly motivates all work in this plan.
- ✅ **Boundary-preserving design**: No application package boundaries are crossed. `clients/intermedium` and `tools/map-editor` are built as-is; only CI env vars and deploy steps are added. The GKE Ingress and backend API routing are unchanged.
- ✅ **Contract-explicit interfaces**: IC-001 (`VITE_API_BASE_URL`) and IC-002 (GCS bucket access policy) are documented in the spec. No new cross-package contracts are introduced.
- ✅ **Verifiable increments**: Each user story has independently testable acceptance scenarios (see spec). Infrastructure-only work has no runnable unit tests; smoke tests (browser navigation, IAP redirect, CDN invalidation) serve as verification.
- ✅ **Documentation impact**: `docs/architecture.md` Decided Stack table update and `deploy/frontend/README.md` creation are planned. `deploy/staging/README.md` front-end serving notes are included.

## Project Structure

### Documentation (this feature)

```text
specs/017-frontend-deploy-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (infrastructure entity model)
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source (repository root)

```text
deploy/
└── frontend/
    ├── README.md          # One-time GCS + LB + IAP setup commands (gcloud)
    └── setup.sh           # Optional helper — wraps gcloud commands in order

.github/workflows/
└── production-deploy.yml  # Extended: build-frontend + sync-gcs + invalidate-cdn jobs

docs/
└── architecture.md        # Decided Stack table updated (front-end hosting + IAP)
```

No new packages. No new top-level directories (deploy/ already exists).

**Structure Decision**: All new artifacts live under `deploy/frontend/` (infrastructure runbooks) and extend the existing `production-deploy.yml`. This matches the pattern established by `deploy/k8s/` (infrastructure config) and `deploy/staging/` (Compose config) in ADR-0007.

## Research Summary

See [research.md](./research.md) for full findings. Key decisions:

| Topic | Decision |
|-------|----------|
| IAP on GCS backend bucket | Must verify before provisioning; Cloud Run (nginx:alpine) is the ready fallback for admin if unsupported |
| GCP auth in CI | Reuse existing Workload Identity SA; add `roles/storage.objectAdmin` on new buckets |
| `VITE_API_BASE_URL` | GitHub Actions secret; build step fails explicitly if unset |
| CDN invalidation | `/*` on intermedium bucket after each deploy; `--async` so pipeline doesn't block |
| Domains | `play.matrix.relateby.dev` (Intermedium) and `admin.matrix.relateby.dev` (Admin); new static IP; multi-domain Google-managed cert |

## Phase 1: Infrastructure Design

### Infrastructure entities

See [data-model.md](./data-model.md) for the full entity model.

Key resources and their relationships:

```
gs://aie-matrix-intermedium  ──►  GCS backend bucket (public)  ──►┐
                                                                    ├──► URL map  ──►  Global forwarding rule (new static IP)
gs://aie-matrix-admin        ──►  GCS backend bucket (private) ──►┘
                                        │
                                        └──► IAP backend config
                                               │
                                               └──► IAM binding (roles/iap.httpsResourceAccessor)
```

### One-time infrastructure provisioning (gcloud)

Documented in `deploy/frontend/README.md` and `deploy/frontend/setup.sh`. Execution order:

1. **Reserve static IP** for the front-end LB (separate from `aie-matrix-ingress`):
   ```bash
   gcloud compute addresses create aie-matrix-frontend --global
   ```

2. **Create GCS buckets**:
   ```bash
   gcloud storage buckets create gs://aie-matrix-intermedium \
     --location=us-central1 --uniform-bucket-level-access
   gcloud storage buckets create gs://aie-matrix-admin \
     --location=us-central1 --uniform-bucket-level-access
   # Make intermedium public
   gcloud storage buckets add-iam-policy-binding gs://aie-matrix-intermedium \
     --member=allUsers --role=roles/storage.objectViewer
   ```

3. **Create GCS backend buckets** (GCP LB resource, distinct from the GCS buckets):
   ```bash
   gcloud compute backend-buckets create intermedium-backend \
     --gcs-bucket-name=aie-matrix-intermedium --enable-cdn
   gcloud compute backend-buckets create admin-backend \
     --gcs-bucket-name=aie-matrix-admin
   ```

4. **Verify IAP on backend buckets** (research Finding 1):
   ```bash
   gcloud compute backend-buckets update admin-backend \
     --iap=enabled,oauth2-client-id=<id>,oauth2-client-secret=<secret>
   ```
   If this command is rejected (IAP not supported on backend buckets), use the Cloud Run fallback: deploy an `nginx:alpine` Cloud Run service serving the admin bucket contents, and apply IAP to that Cloud Run backend instead.

5. **Create URL map** with host rules for the two subdomains:
   ```bash
   gcloud compute url-maps create aie-matrix-frontend \
     --default-backend-bucket=intermedium-backend
   gcloud compute url-maps import aie-matrix-frontend \
     --source=deploy/frontend/url-map.yaml
   ```
   (`deploy/frontend/url-map.yaml` defines the `play.matrix.relateby.dev` → intermedium and `admin.matrix.relateby.dev` → admin host rules.)

6. **Create Google-managed TLS cert** covering both subdomains:
   ```bash
   gcloud compute ssl-certificates create aie-matrix-frontend-cert \
     --domains=play.matrix.relateby.dev,admin.matrix.relateby.dev \
     --global
   ```

7. **Create HTTPS proxy + forwarding rule**:
   ```bash
   gcloud compute target-https-proxies create aie-matrix-frontend-proxy \
     --url-map=aie-matrix-frontend \
     --ssl-certificates=aie-matrix-frontend-cert
   gcloud compute forwarding-rules create aie-matrix-frontend-rule \
     --address=aie-matrix-frontend \
     --global --target-https-proxy=aie-matrix-frontend-proxy --ports=443
   ```

8. **Add DNS records** (`play.matrix.relateby.dev` and `admin.matrix.relateby.dev` → new static IP).

9. **Grant CI service account bucket write access**:
   ```bash
   for bucket in aie-matrix-intermedium aie-matrix-admin; do
     gcloud storage buckets add-iam-policy-binding gs://$bucket \
       --member=serviceAccount:<GCP_SERVICE_ACCOUNT> \
       --role=roles/storage.objectAdmin
   done
   ```

### CI/CD additions to `production-deploy.yml`

New job `build-deploy-frontend` (runs in parallel with the container build jobs; depends on GCP auth which is established early):

```yaml
- name: Build Intermedium
  env:
    VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
  run: |
    [ -n "$VITE_API_BASE_URL" ] || { echo "VITE_API_BASE_URL is required"; exit 1; }
    pnpm --filter @aie-matrix/intermedium build

- name: Build Admin
  env:
    VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}
  run: |
    pnpm --filter @aie-matrix/map-editor build

- name: Sync Intermedium to GCS
  run: gsutil -m rsync -r -d clients/intermedium/dist/ gs://aie-matrix-intermedium/

- name: Sync Admin to GCS
  run: gsutil -m rsync -r -d tools/map-editor/dist/ gs://aie-matrix-admin/

- name: Invalidate Intermedium CDN cache
  run: |
    gcloud compute url-maps invalidate-cdn-cache aie-matrix-frontend \
      --path "/*" --host play.matrix.relateby.dev --async
```

**New GitHub Actions secret required**: `VITE_API_BASE_URL` = `https://matrix.relateby.dev`

### URL map configuration (`deploy/frontend/url-map.yaml`)

```yaml
defaultService: https://www.googleapis.com/compute/v1/projects/aie-matrix/global/backendBuckets/intermedium-backend
hostRules:
  - hosts:
      - play.matrix.relateby.dev
    pathMatcher: intermedium-paths
  - hosts:
      - admin.matrix.relateby.dev
    pathMatcher: admin-paths
pathMatchers:
  - name: intermedium-paths
    defaultService: https://www.googleapis.com/compute/v1/projects/aie-matrix/global/backendBuckets/intermedium-backend
  - name: admin-paths
    defaultService: https://www.googleapis.com/compute/v1/projects/aie-matrix/global/backendBuckets/admin-backend
```

## Quickstart

See [quickstart.md](./quickstart.md) for step-by-step local development and staging verification instructions.

## Post-Design Constitution Re-check

- ✅ Infrastructure resources (`deploy/frontend/`) are named and structured consistently with `deploy/k8s/` and `deploy/staging/`.
- ✅ CI additions to `production-deploy.yml` are additive — existing backend deploy steps are unchanged.
- ✅ IAP fallback (Cloud Run) is documented in `research.md` and `deploy/frontend/README.md`; if taken, no ADR amendment is needed because the decision criteria are preserved.
- ✅ `docs/architecture.md` Decided Stack update is captured as a documentation task.
- ⚠️ **IAP verification** (research Finding 1) is a prerequisite gate before infrastructure provisioning. This must be done before the first GCP setup run.
