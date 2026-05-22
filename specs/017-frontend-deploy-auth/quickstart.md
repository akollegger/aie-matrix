# Quickstart: Frontend Deployment and Auth

## Local Development (Tier 1)

Both front-ends run as standard Vite dev servers. No GCS, CDN, or IAP involved.

```bash
# Intermedium
cd clients/intermedium
pnpm dev          # http://localhost:5180

# Admin (map editor)
cd tools/map-editor
pnpm dev          # http://localhost:5182
```

Set `VITE_API_BASE_URL` in a local `.env` file if you need to point at a non-default backend:

```bash
# clients/intermedium/.env.local (git-ignored)
VITE_API_BASE_URL=http://localhost:8787

# tools/map-editor/.env.local (git-ignored)
VITE_API_BASE_URL=http://localhost:8787
```

## Staging Validation (Tier 2)

Serve built artifacts locally via `vite preview` to validate the production build before pushing a version tag:

```bash
# Build first (replace URL with your staging host)
VITE_API_BASE_URL=http://<staging-host>:8787 pnpm --filter @aie-matrix/intermedium build
pnpm --filter @aie-matrix/intermedium preview   # http://localhost:4173

VITE_API_BASE_URL=http://<staging-host>:8787 pnpm --filter @aie-matrix/map-editor build
pnpm --filter @aie-matrix/map-editor preview    # http://localhost:4174
```

Alternatively, the docker-compose staging stack can serve both via nginx containers. See `deploy/staging/README.md`.

## Infrastructure Provisioning (One-time, Tier 3)

Run from the repo root after authenticating with `gcloud auth login`:

```bash
bash deploy/frontend/setup.sh
```

This script runs the gcloud commands documented in `deploy/frontend/README.md` in the correct order:
1. Reserve static IP
2. Create GCS buckets with correct access policies
3. Build and push `admin-nginx` Docker image to Artifact Registry
4. Create dedicated Cloud Run service account (`admin-frontend-sa`) and grant it bucket read access
5. Create Intermedium CDN backend bucket
6. Deploy Cloud Run `admin-frontend` (gen2, GCS Fuse volume mount, dedicated SA)
7. Create serverless NEG and global backend service (`admin-backend-service`) for IAP
8. Create URL map, TLS cert, HTTPS proxy, forwarding rule
9. Print DNS records (manual — the script prints the IP and required entries)
10. Print IAP OAuth setup instructions (manual — requires GCP Console)

The script is idempotent — re-running it on an already-provisioned project is safe.

> **Note**: `gcloud builds submit` is the recommended way to build the admin-nginx image if Docker is not available locally (e.g. on Apple Silicon with Podman only):
> ```bash
> gcloud builds submit --tag=us-central1-docker.pkg.dev/aie-matrix/aie-matrix/admin-nginx:latest deploy/frontend/nginx-admin/
> ```

## Verifying a Production Deploy

After pushing a `v*` tag and the `production-deploy.yml` workflow completes:

1. **Intermedium public access** — open `https://play.matrix.relateby.dev` in a private browser window. The deck.gl scene should load with no login prompt.

2. **Admin IAP gate** — open `https://admin.matrix.relateby.dev` in a private browser window. You should be redirected to Google OAuth login.

3. **Admin authorized access** — log in with a Google account in the IAP access list. You should land on the Admin interface.

4. **Admin unauthorized access** — log in with a Google account NOT in the IAP access list. You should receive a 403 denial page.

5. **CDN invalidation** — confirm the new build is live by checking a version indicator (if present) or a visible UI change introduced in the tag. If the previous build is still showing, wait up to 5 minutes for CDN propagation.

## Adding a New Operator

```bash
gcloud projects add-iam-policy-binding aie-matrix \
  --member=user:name@example.com \
  --role=roles/iap.httpsResourceAccessor
```

Access takes effect within ~60 seconds. No redeployment required.

> This grants access to all IAP-protected resources in the project (`admin-backend-service` and `aie-matrix/server`). If per-resource scoping is needed in future, add `--condition="expression=request.host=='admin.matrix.relateby.dev',title=admin-frontend"` and match the same condition on remove.

## Removing an Operator

```bash
gcloud projects remove-iam-policy-binding aie-matrix \
  --member=user:name@example.com \
  --role=roles/iap.httpsResourceAccessor
```
