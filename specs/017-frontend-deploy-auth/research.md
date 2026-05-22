# Research: Frontend Deployment and Auth

**Feature**: 017-frontend-deploy-auth  
**Date**: 2026-05-21

## Finding 1: IAP on GCS Backend Buckets — Verify Before Build

**Decision**: Treat IAP-on-GCS-backend-bucket as unverified; hold Cloud Run (nginx) as the ready fallback for the admin surface only.

**Detail**: ADR-0008 states "IAP is applied as a Load Balancer Backend Service attribute on the admin backend bucket." GCP's Cloud IAP documentation confirms IAP support for GCLB backend services backed by Compute Engine and GKE. Support for GCS *backend buckets* specifically is less clearly documented and may require enabling IAP via `gcloud compute backend-buckets update --iap`. This must be tested before infrastructure provisioning begins.

**Fallback (if backend-bucket IAP is unsupported)**: Replace the admin GCS backend bucket with a Cloud Run service running `nginx:alpine` that serves the static `dist/` contents. Cloud Run IAP is unambiguously supported. Cost is negligible (Cloud Run bills on invocations; admin traffic is minimal). The intermedium bucket remains a standard GCS backend bucket with public CDN — unaffected.

**Rationale**: ADR-0008 was accepted with this mechanism; this finding does not supersede it. The ADR's *outcome* (IAP-gated admin UI, zero application code) is unchanged. Only the exact backend resource type may shift. If the fallback is taken, document the deviation in `deploy/frontend/README.md`; no ADR amendment needed because the decision criteria (IAP, no app code, Google Identity) are preserved.

**Alternatives considered**: Signed URL approach (generates time-limited GCS object URLs). Rejected — requires application code to issue URLs and does not provide the clean IAP redirect UX described in the spec.

---

## Finding 2: Production Deploy Workflow — Existing GCP Auth is Reusable

**Decision**: Extend `production-deploy.yml` with front-end build/sync/invalidate steps in the same job (or a parallel job); no new GCP auth credentials needed.

**Detail**: `production-deploy.yml` already authenticates via Workload Identity Federation (`google-github-actions/auth@v2`) and sets up `gcloud`. The service account behind `GCP_SERVICE_ACCOUNT` needs two additional IAM roles on the new buckets:
- `roles/storage.objectAdmin` on `gs://aie-matrix-intermedium` and `gs://aie-matrix-admin` (for `gsutil rsync`)
- `roles/compute.loadBalancerAdmin` scoped to the URL map (for CDN cache invalidation via `gcloud compute url-maps invalidate-cdn-cache`)

These are bucket-level IAM bindings, not project-level, so they can be added without widening the service account's project permissions.

**Rationale**: Reusing the existing Workload Identity SA avoids creating a second set of credentials for the same pipeline. The `gcloud` SDK is already configured in the deploy job.

---

## Finding 3: VITE_API_BASE_URL — CI Secret, Not Committed File

**Decision**: Pass `VITE_API_BASE_URL` as a GitHub Actions secret (`secrets.VITE_API_BASE_URL`), injected into the build step via `env:`. Do not commit `.env.production` files.

**Detail**: Vite inlines `VITE_*` env vars at build time. If `VITE_API_BASE_URL` is unset, API calls will fail at runtime (the variable resolves to `undefined`). The existing domain is `matrix.relateby.dev` (from `deploy/k8s/ingress.yaml`). The correct production value is `https://matrix.relateby.dev`. Failing the build when this secret is absent requires an explicit check in the CI step:
```bash
[ -n "$VITE_API_BASE_URL" ] || { echo "VITE_API_BASE_URL is required"; exit 1; }
```

**Rationale**: Committed `.env.production` files would hardcode a production URL that must change if the domain changes, creating a repo-state dependency. A CI secret is authoritative and auditable.

---

## Finding 4: CDN Cache Invalidation — Index Only, Assets Self-Invalidate

**Decision**: Invalidate only `/*` on the intermedium backend bucket after each deploy (catches `index.html`). No invalidation needed for `admin` (IAP sessions always fetch fresh content; no CDN for private buckets).

**Detail**: Vite's default build hashes asset filenames (`/assets/index-[hash].js`). These never need CDN invalidation — old hashes simply become unreachable. `index.html` is never hashed and is the entry point the browser caches. The gcloud command:
```bash
gcloud compute url-maps invalidate-cdn-cache <url-map-name> \
  --path "/*" \
  --host <intermedium-domain> \
  --async
```
`--async` prevents the pipeline from blocking on propagation (which can take 1–5 minutes). The pipeline should not fail waiting for CDN propagation; the sync to GCS is the authoritative deploy step.

**Rationale**: Invalidating only what needs invalidation keeps the CI step fast and avoids unnecessary CDN churn on assets that are already fingerprinted.

---

## Finding 5: Front-End Domain — New Subdomain Alongside Existing Backend

**Decision**: Front-ends served at `play.matrix.relateby.dev` (Intermedium) and `admin.matrix.relateby.dev` (Admin) via a second static IP and a wildcard cert covering `*.matrix.relateby.dev`.

**Detail**: `matrix.relateby.dev` is already claimed by the GKE Ingress (IP `8.233.117.99`). The front-end Cloud Load Balancer needs a separate static IP. The GKE Ingress's existing `ManagedCertificate` covers only `matrix.relateby.dev`. A wildcard cert covering `*.matrix.relateby.dev` would serve both the existing GKE Ingress and the new front-end LB — but GKE `ManagedCertificate` resources do not support wildcards. Instead: create a Google-managed cert on the front-end LB covering `play.matrix.relateby.dev` and `admin.matrix.relateby.dev` (multi-domain cert, supported by GCLB). The existing GKE Ingress cert is unchanged.

**Subdomains chosen (not path-based)**: Starting with subdomains directly (rather than path-based on a third domain) is cleaner given that `matrix.relateby.dev` is already in use. The ADR permits this; subdomain routing is fully supported by the URL map.

**Rationale**: Avoids collision with the existing static IP, keeps GKE Ingress config unchanged, and establishes clean named surfaces (`play` for spectators, `admin` for operators) from day one.
