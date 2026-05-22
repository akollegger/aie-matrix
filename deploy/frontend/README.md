# Front-End Deployment Runbook

This directory documents the one-time GCP infrastructure setup and ongoing operational procedures for hosting the **Intermedium** and **Admin** Vite SPAs (ADR-0008).

- **Intermedium** (`play.matrix.relateby.dev`) — public, Cloud CDN, no auth
- **Admin** (`admin.matrix.relateby.dev`) — private, IAP-gated, Google Identity only

Both are served from GCS backend buckets via a single Cloud Load Balancer (separate from the GKE Ingress at `matrix.relateby.dev`).

---

## Prerequisites

- `gcloud` CLI authenticated: `gcloud auth login`
- GCP project set: `gcloud config set project aie-matrix`
- Existing GKE cluster and Artifact Registry from ADR-0007 Phase 1 are in place
- `gsutil` available (bundled with gcloud SDK)

---

## Phase Order

Run the phases in this order. Each phase has a checkpoint — do not proceed until it passes.

1. [Phase 1: Reserve Static IP](#phase-1-reserve-static-ip)
2. [Phase 2: Create GCS Buckets](#phase-2-create-gcs-buckets)
3. [Phase 3: Grant CI Service Account Permissions](#phase-3-grant-ci-service-account-permissions)
4. [Phase 4: Build and Push admin-nginx Image](#phase-4-build-and-push-admin-nginx-image)
5. [Phase 5: Grant Cloud Run SA Access to GCS Bucket](#phase-5-grant-cloud-run-sa-access-to-gcs-bucket)
6. [Phase 6: Create GCP Backend Bucket (Intermedium)](#phase-6-create-gcp-backend-bucket-intermedium)
7. [Phase 7: Deploy Cloud Run admin-frontend](#phase-7-deploy-cloud-run-admin-frontend)
8. [Phase 8: Serverless NEG and Backend Service](#phase-8-serverless-neg-and-backend-service)
9. [Phase 9: Create Load Balancer (URL Map, Cert, Proxy, Forwarding Rule)](#phase-9-create-load-balancer)
10. [Phase 10: DNS Records](#phase-10-dns-records)
11. [Phase 11: IAP OAuth and Access Configuration](#phase-11-iap-oauth-and-access-configuration)
12. [Phase 12: Operator Access Management](#phase-12-operator-access-management)
13. [Verification](#verification)

---

## Phase 1: Reserve Static IP

Reserve a global static IP for the front-end Load Balancer (separate from the GKE Ingress IP `aie-matrix-ingress`):

```bash
gcloud compute addresses create aie-matrix-frontend --global
```

Record the assigned IP:

```bash
gcloud compute addresses describe aie-matrix-frontend --global --format="value(address)"
```

**Checkpoint**: `gcloud compute addresses list | grep aie-matrix-frontend` shows a reserved IP. ✅

---

## Phase 2: Create GCS Buckets

### Intermedium (public)

```bash
gcloud storage buckets create gs://aie-matrix-intermedium \
  --location=us-central1 \
  --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding gs://aie-matrix-intermedium \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

### Admin (private — no public access)

```bash
gcloud storage buckets create gs://aie-matrix-admin \
  --location=us-central1 \
  --uniform-bucket-level-access
```

> If either bucket name is already taken globally, choose an alternative prefix (e.g., `aie-matrix-2025-intermedium`) and update all references in this runbook, `deploy/frontend/url-map.yaml`, and `.github/workflows/production-deploy.yml`.

**Checkpoint**: Both buckets appear in `gcloud storage buckets list --filter="name:aie-matrix-"`. ✅

---

## Phase 3: Grant CI Service Account Permissions

The GitHub Actions service account (stored in the `GCP_SERVICE_ACCOUNT` Actions secret) needs write access to both buckets for `gsutil rsync` to work:

```bash
SA=$(gcloud secrets versions access latest --secret=GCP_SERVICE_ACCOUNT 2>/dev/null || echo "<paste-service-account-email-here>")

for bucket in aie-matrix-intermedium aie-matrix-admin; do
  gcloud storage buckets add-iam-policy-binding gs://$bucket \
    --member="serviceAccount:${SA}" \
    --role=roles/storage.objectAdmin
done
```

**Checkpoint**: `gcloud storage buckets get-iam-policy gs://aie-matrix-intermedium` shows the SA with `roles/storage.objectAdmin`. ✅

---

## Phase 4: Build and Push admin-nginx Image

GCP does not support IAP on backend buckets — only on backend services. The admin frontend therefore runs as a Cloud Run gen2 service. The GCS bucket `gs://aie-matrix-admin` is mounted as a filesystem volume via Cloud Run's built-in GCS Fuse support; nginx reads files from it directly with no auth code in the container.

The Dockerfile is at [`deploy/frontend/nginx-admin/Dockerfile`](nginx-admin/Dockerfile). Build and push before deploying Cloud Run:

```bash
REGISTRY=us-central1-docker.pkg.dev
PROJECT=aie-matrix
REPO=aie-matrix
ADMIN_IMAGE="${REGISTRY}/${PROJECT}/${REPO}/admin-nginx:latest"

gcloud auth configure-docker ${REGISTRY}
docker build -t "${ADMIN_IMAGE}" deploy/frontend/nginx-admin/
docker push "${ADMIN_IMAGE}"
```

**Checkpoint**: `gcloud artifacts docker images list us-central1-docker.pkg.dev/aie-matrix/aie-matrix --filter="package:admin-nginx"` shows the image. ✅

---

## Phase 5: Grant Cloud Run SA Access to GCS Bucket

The Cloud Run service runs under the default compute service account. Grant it read access to `gs://aie-matrix-admin` so the GCS Fuse volume mount works:

```bash
PROJECT_NUMBER=$(gcloud projects describe aie-matrix --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding gs://aie-matrix-admin \
  --member="serviceAccount:${CLOUD_RUN_SA}" \
  --role=roles/storage.objectViewer
```

**Checkpoint**: `gcloud storage buckets get-iam-policy gs://aie-matrix-admin` shows the compute SA with `roles/storage.objectViewer`. ✅

---

## Phase 6: Create GCP Backend Bucket (Intermedium)

```bash
gcloud compute backend-buckets create intermedium-backend \
  --gcs-bucket-name=aie-matrix-intermedium \
  --enable-cdn
```

**Checkpoint**: `gcloud compute backend-buckets list | grep intermedium-backend` shows the backend bucket. ✅

---

## Phase 7: Deploy Cloud Run admin-frontend

```bash
REGISTRY=us-central1-docker.pkg.dev
PROJECT=aie-matrix
REPO=aie-matrix
ADMIN_IMAGE="${REGISTRY}/${PROJECT}/${REPO}/admin-nginx:latest"

gcloud run deploy admin-frontend \
  --image="${ADMIN_IMAGE}" \
  --region=us-central1 \
  --allow-unauthenticated \
  --execution-environment=gen2 \
  --add-volume=name=admin-bucket,type=cloud-storage,bucket=aie-matrix-admin \
  --add-volume-mount=volume=admin-bucket,mount-path=/usr/share/nginx/html \
  --service-account=admin-frontend-sa@aie-matrix.iam.gserviceaccount.com \
  --port=8080
```

> `--allow-unauthenticated` is set because IAP is enforced at the load balancer level (Phase 11), not at the Cloud Run service itself. The direct `*.run.app` URL is not published.
>
> **`--service-account` is required.** The default Compute Engine SA has a broken metadata token endpoint in this project and cannot authenticate to GCS — the GCS Fuse mount fails with UNAUTHENTICATED errors at startup. The dedicated `admin-frontend-sa` SA must be used.

**Checkpoint**: `gcloud run services describe admin-frontend --region=us-central1` shows status READY. ✅

---

## Phase 8: Serverless NEG and Backend Service

Cloud Run must be wired into the load balancer via a serverless NEG and a global backend service. This is the resource that appears in the IAP console.

```bash
# Serverless NEG pointing at the Cloud Run service
gcloud compute network-endpoint-groups create admin-frontend-neg \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=admin-frontend

# Global backend service
gcloud compute backend-services create admin-backend-service \
  --global

# Wire the NEG into the backend service
gcloud compute backend-services add-backend admin-backend-service \
  --global \
  --network-endpoint-group=admin-frontend-neg \
  --network-endpoint-group-region=us-central1
```

**Checkpoint**: `gcloud compute backend-services describe admin-backend-service --global` shows the NEG backend. ✅

---

## Phase 9: Create Load Balancer

**Google-managed TLS certificates are immutable** — domains cannot be added after creation. The cert is provisioned with both subdomains now, even though `admin-backend` is not yet wired.

### Step 1: Create URL map (intermedium only at first)

```bash
gcloud compute url-maps create aie-matrix-frontend \
  --default-backend-bucket=intermedium-backend

gcloud compute url-maps import aie-matrix-frontend \
  --source=deploy/frontend/url-map.yaml \
  --global
```

> `url-map.yaml` contains only the `play.*` → `intermedium-backend` host rule at this point. The admin host rule is added after `admin-backend` is created (next step).

### Step 2: Add admin host rule to URL map

Once `admin-backend` (or Cloud Run backend) exists:

```bash
# Edit deploy/frontend/url-map.yaml to add the admin host rule, then re-import:
gcloud compute url-maps import aie-matrix-frontend \
  --source=deploy/frontend/url-map.yaml \
  --global
```

### Step 3: Create TLS certificate (both subdomains)

```bash
gcloud compute ssl-certificates create aie-matrix-frontend-cert \
  --domains=play.matrix.relateby.dev,admin.matrix.relateby.dev \
  --global
```

### Step 4: Create HTTPS proxy and forwarding rule

```bash
gcloud compute target-https-proxies create aie-matrix-frontend-proxy \
  --url-map=aie-matrix-frontend \
  --ssl-certificates=aie-matrix-frontend-cert \
  --global

gcloud compute forwarding-rules create aie-matrix-frontend-rule \
  --address=aie-matrix-frontend \
  --global \
  --target-https-proxy=aie-matrix-frontend-proxy \
  --ports=443
```

**Checkpoint**: `gcloud compute forwarding-rules list | grep aie-matrix-frontend-rule` shows the rule pointing at the static IP. ✅

---

## Phase 10: DNS Records

Add two A records in your DNS provider (both point at the `aie-matrix-frontend` static IP reserved in Phase 1):

| Hostname | Type | Value |
|----------|------|-------|
| `play.matrix.relateby.dev` | A | `<aie-matrix-frontend IP>` |
| `admin.matrix.relateby.dev` | A | `<aie-matrix-frontend IP>` |

> TLS certificate provisioning begins after DNS propagates and typically completes within 15 minutes. Check status:
> ```bash
> gcloud compute ssl-certificates describe aie-matrix-frontend-cert --global --format="value(managed.status)"
> ```
> Wait for `ACTIVE` before testing.

---

## Phase 11: IAP OAuth and Access Configuration

### Step 1: Create OAuth consent screen

In the GCP Console: **APIs & Services → OAuth consent screen**
- User type: **Internal** (restricts to your Google Workspace org)
- App name: `aie-matrix Admin`
- Complete required fields; no scopes needed beyond the default

### Step 2: Create OAuth client ID

In the GCP Console: **APIs & Services → Credentials → Create Credentials → OAuth client ID**
- Application type: **Web application**
- Authorized redirect URIs: add the IAP redirect URI shown in the IAP console (format: `https://iap.googleapis.com/v1/oauth/clientIds/<client-id>:handleRedirect`)
- Note the **Client ID** and **Client secret**

### Step 3: Enable IAP on the backend service

```bash
gcloud compute backend-services update admin-backend-service \
  --global \
  --iap=enabled,oauth2-client-id=<CLIENT_ID>,oauth2-client-secret=<CLIENT_SECRET>
```

After this step `admin-backend-service` appears in the IAP console (**Security → Identity-Aware Proxy → Backend services → admin-backend-service**).

**Checkpoint**: IAP toggle is blue (enabled) next to `admin-backend-service` in the IAP console. ✅

---

## Phase 12: Operator Access Management

### Grant access to a new operator

```bash
gcloud projects add-iam-policy-binding aie-matrix \
  --member=user:name@example.com \
  --role=roles/iap.httpsResourceAccessor
```

Access takes effect within ~60 seconds. No redeployment required.

> This grants access to all IAP-protected resources in the project. If per-resource scoping is needed, add `--condition="expression=request.host=='admin.matrix.relateby.dev',title=admin-frontend"` and include the same condition on remove.

### Revoke access

```bash
gcloud projects remove-iam-policy-binding aie-matrix \
  --member=user:name@example.com \
  --role=roles/iap.httpsResourceAccessor
```

---

## Verification

After full provisioning and first CI deploy:

1. **Intermedium public** — navigate to `https://play.matrix.relateby.dev` in a private browser. Confirm the deck.gl scene loads with no auth prompt.

2. **Admin IAP gate** — navigate to `https://admin.matrix.relateby.dev` in a private browser. Confirm Google OAuth redirect occurs. ✅

3. **Authorized access** — log in with an authorized operator account. Confirm the Admin UI is served. ✅

4. **Unauthorized access** — log in with a non-authorized Google account. Confirm "Access blocked" (OAuth consent screen is Internal, so personal Gmail accounts are rejected before reaching the load balancer). ✅

5. **CDN freshness** — after a tag push, confirm the updated Intermedium build appears on next page load (allow up to 5 minutes for CDN propagation after `--async` invalidation).
