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
4. [Phase 4: IAP Verification (Admin only)](#phase-4-iap-verification-admin-only)
5. [Phase 5: Create GCP Backend Bucket Resources](#phase-5-create-gcp-backend-bucket-resources)
6. [Phase 6: Create Load Balancer (URL Map, Cert, Proxy, Forwarding Rule)](#phase-6-create-load-balancer)
7. [Phase 7: DNS Records](#phase-7-dns-records)
8. [Phase 8: IAP OAuth and Access Configuration](#phase-8-iap-oauth-and-access-configuration)
9. [Phase 9: Operator Access Management](#phase-9-operator-access-management)
10. [Verification](#verification)

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

## Phase 4: IAP Verification (Admin only)

### Chosen IAP Implementation

<!-- FILL IN after running the verification command below -->
**Status**: ⬜ Not yet verified  
**Chosen path**: _backend-bucket IAP_ or _Cloud Run fallback_ (update after T015)

### Verification command

Create a throwaway test backend bucket and attempt to enable IAP:

```bash
# Create a temporary backend bucket for testing
gcloud compute backend-buckets create iap-test-bucket \
  --gcs-bucket-name=aie-matrix-admin

# Attempt to enable IAP on it
gcloud compute backend-buckets update iap-test-bucket \
  --iap=enabled,oauth2-client-id=TEST,oauth2-client-secret=TEST 2>&1

# Clean up
gcloud compute backend-buckets delete iap-test-bucket --quiet
```

**If the command succeeds** (or fails only on invalid credentials, not "unsupported"): use the **backend-bucket IAP path** in Phase 5.

**If the command returns "IAP not supported on backend buckets"**: use the **Cloud Run fallback path** in Phase 5.

Update the "Chosen IAP Implementation" field above before proceeding.

---

## Phase 5: Create GCP Backend Bucket Resources

### Intermedium backend (always the same)

```bash
gcloud compute backend-buckets create intermedium-backend \
  --gcs-bucket-name=aie-matrix-intermedium \
  --enable-cdn
```

### Admin backend — two paths depending on Phase 4 outcome

#### Path A: Backend-bucket IAP (preferred)

```bash
gcloud compute backend-buckets create admin-backend \
  --gcs-bucket-name=aie-matrix-admin
# IAP is applied in Phase 8 after OAuth credentials are ready
```

#### Path B: Cloud Run fallback

```bash
# Deploy a minimal nginx container that serves from the admin GCS bucket
gcloud run deploy admin-frontend \
  --image=nginx:alpine \
  --region=us-central1 \
  --no-allow-unauthenticated \
  --set-env-vars=BUCKET=aie-matrix-admin
# IAP is applied to the Cloud Run backend service in Phase 8
```

> The Cloud Run nginx image needs a startup script that fetches assets from the GCS bucket. A Dockerfile for this is at `deploy/frontend/nginx-admin/Dockerfile` if the fallback path is needed.

**Checkpoint**: `gcloud compute backend-buckets list | grep intermedium-backend` shows the backend bucket. ✅

---

## Phase 6: Create Load Balancer

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

## Phase 7: DNS Records

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

## Phase 8: IAP OAuth and Access Configuration

### Step 1: Create OAuth consent screen

In the GCP Console: **APIs & Services → OAuth consent screen**
- User type: **Internal** (restricts to your Google Workspace org)
- App name: `aie-matrix Admin`
- Complete required fields; no scopes needed beyond the default

### Step 2: Create OAuth client ID

In the GCP Console: **APIs & Services → Credentials → Create Credentials → OAuth client ID**
- Application type: **Web application**
- Authorized redirect URIs: add the IAP redirect URI shown in the IAP console after enabling (format: `https://iap.googleapis.com/v1/oauth/clientIds/<client-id>:handleRedirect`)
- Note the **Client ID** and **Client secret**

### Step 3: Enable IAP

#### Path A (backend-bucket IAP):
```bash
gcloud compute backend-buckets update admin-backend \
  --iap=enabled,oauth2-client-id=<CLIENT_ID>,oauth2-client-secret=<CLIENT_SECRET>
```

#### Path B (Cloud Run):
Enable IAP on the Cloud Run service via the GCP Console: **Cloud Run → admin-frontend → Security → Enable IAP**.

---

## Phase 9: Operator Access Management

### Grant access to a new operator

```bash
gcloud projects add-iam-policy-binding aie-matrix \
  --member=user:name@example.com \
  --role=roles/iap.httpsResourceAccessor \
  --condition="expression=request.host=='admin.matrix.relateby.dev',title=admin-frontend"
```

Access takes effect within ~60 seconds. No redeployment required.

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

2. **Admin IAP gate** — navigate to `https://admin.matrix.relateby.dev` in a private browser. Confirm Google OAuth redirect occurs.

3. **Authorized access** — log in with an authorized operator account. Confirm the Admin UI is served.

4. **Unauthorized access** — log in with a non-authorized Google account. Confirm HTTP 403.

5. **CDN freshness** — after a tag push, confirm the updated Intermedium build appears on next page load (allow up to 5 minutes for CDN propagation after `--async` invalidation).
