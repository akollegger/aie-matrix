#!/usr/bin/env bash
# deploy/frontend/setup.sh
#
# Idempotent one-time provisioning of GCP front-end infrastructure (ADR-0008).
# Run from the repo root after authenticating with gcloud:
#
#   gcloud auth login
#   gcloud config set project aie-matrix
#   bash deploy/frontend/setup.sh
#
# Re-running is safe — existing resources are skipped with a warning.
#
# Admin frontend (map-editor) is served via Cloud Run gen2 + GCS Fuse volume
# mount. IAP is applied to the global backend service (not a backend bucket —
# GCP does not support IAP on backend buckets).

set -euo pipefail

PROJECT="${GCP_PROJECT:-aie-matrix}"
REGION="${GCP_REGION:-us-central1}"
REGISTRY="us-central1-docker.pkg.dev"
REPO="aie-matrix"
ADMIN_IMAGE="${REGISTRY}/${PROJECT}/${REPO}/admin-nginx:latest"

echo "==> aie-matrix front-end infrastructure setup"
echo "    Project : $PROJECT"
echo "    Region  : $REGION"
echo ""

# ── Helper: skip if resource already exists ──────────────────────────────────

exists_address()        { gcloud compute addresses describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_bucket()         { gcloud storage buckets describe "gs://$1" &>/dev/null; }
exists_backend_bucket() { gcloud compute backend-buckets describe "$1" --project="$PROJECT" &>/dev/null; }
exists_backend_service(){ gcloud compute backend-services describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_neg()            { gcloud compute network-endpoint-groups describe "$1" --region="$REGION" --project="$PROJECT" &>/dev/null; }
exists_url_map()        { gcloud compute url-maps describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_cert()           { gcloud compute ssl-certificates describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_proxy()          { gcloud compute target-https-proxies describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_rule()           { gcloud compute forwarding-rules describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_cloud_run()      { gcloud run services describe "$1" --region="$REGION" --project="$PROJECT" &>/dev/null; }

# ── Phase 1: Static IP ────────────────────────────────────────────────────────

echo "── Phase 1: Static IP ──────────────────────────────────────────────────"
if exists_address aie-matrix-frontend; then
  echo "   SKIP: aie-matrix-frontend already exists"
else
  gcloud compute addresses create aie-matrix-frontend --global --project="$PROJECT"
  echo "   OK: aie-matrix-frontend reserved"
fi
IP=$(gcloud compute addresses describe aie-matrix-frontend --global --project="$PROJECT" --format="value(address)")
echo "   IP: $IP"
echo ""

# ── Phase 2: GCS Buckets ──────────────────────────────────────────────────────

echo "── Phase 2: GCS Buckets ────────────────────────────────────────────────"
for bucket in aie-matrix-intermedium aie-matrix-admin; do
  if exists_bucket "$bucket"; then
    echo "   SKIP: gs://$bucket already exists"
  else
    gcloud storage buckets create "gs://$bucket" \
      --location="$REGION" \
      --uniform-bucket-level-access \
      --project="$PROJECT"
    echo "   OK: gs://$bucket created"
  fi
done

# Make intermedium public
gcloud storage buckets add-iam-policy-binding gs://aie-matrix-intermedium \
  --member=allUsers --role=roles/storage.objectViewer 2>/dev/null || \
  echo "   INFO: allUsers binding on intermedium already present (or skipped)"

# Configure website settings so GCS serves index.html instead of bucket listing
for bucket in aie-matrix-intermedium aie-matrix-admin; do
  gcloud storage buckets update "gs://$bucket" \
    --web-main-page-suffix=index.html \
    --web-error-page=index.html
  echo "   OK: website config set on gs://$bucket"
done
echo ""

# ── Phase 3: CI SA permissions ───────────────────────────────────────────────

echo "── Phase 3: CI SA Permissions ──────────────────────────────────────────"
echo "   Enter the CI service account email (from GCP_SERVICE_ACCOUNT Actions variable):"
read -r SA_EMAIL
if [ -n "$SA_EMAIL" ]; then
  for bucket in aie-matrix-intermedium aie-matrix-admin; do
    gcloud storage buckets add-iam-policy-binding "gs://$bucket" \
      --member="serviceAccount:${SA_EMAIL}" \
      --role=roles/storage.objectAdmin
    echo "   OK: storage.objectAdmin granted on gs://$bucket"
  done
else
  echo "   SKIP: no SA email provided — run manually (see deploy/frontend/README.md Phase 3)"
fi
echo ""

# ── Phase 4: admin-nginx Docker image ────────────────────────────────────────
#
# The admin frontend is served by an nginx container on Cloud Run gen2.
# The GCS bucket gs://aie-matrix-admin is mounted as a filesystem volume —
# nginx reads files from it directly via GCS Fuse, no auth code required.
# IAP is applied to the global backend service (not the Cloud Run service),
# so it appears in the IAP console and supports OAuth-gated access.

echo "── Phase 4: admin-nginx Docker image ───────────────────────────────────"
echo "   Building and pushing $ADMIN_IMAGE ..."
echo "   (Requires Docker authenticated to Artifact Registry)"
echo "   To configure: gcloud auth configure-docker $REGISTRY"
echo ""
if docker build -t "$ADMIN_IMAGE" deploy/frontend/nginx-admin/ 2>/dev/null; then
  docker push "$ADMIN_IMAGE"
  echo "   OK: $ADMIN_IMAGE pushed"
else
  echo "   WARN: Docker build failed or Docker not available."
  echo "   Push the image manually before continuing:"
  echo "     docker build -t $ADMIN_IMAGE deploy/frontend/nginx-admin/"
  echo "     docker push $ADMIN_IMAGE"
  echo "   Continuing with remaining GCP resource setup..."
fi
echo ""

# ── Phase 5: Cloud Run service account ───────────────────────────────────────
#
# NOTE: The default Compute Engine SA (PROJECT_NUMBER-compute@...) has a broken
# metadata server token endpoint in this project and cannot authenticate to GCS.
# A dedicated SA is required for the GCS Fuse volume mount to work.

echo "── Phase 5: Cloud Run SA ───────────────────────────────────────────────"
CLOUD_RUN_SA="admin-frontend-sa@${PROJECT}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$CLOUD_RUN_SA" --project="$PROJECT" &>/dev/null; then
  echo "   SKIP: $CLOUD_RUN_SA already exists"
else
  gcloud iam service-accounts create admin-frontend-sa \
    --display-name="admin-frontend Cloud Run SA" \
    --project="$PROJECT"
  echo "   OK: $CLOUD_RUN_SA created"
fi

gcloud storage buckets add-iam-policy-binding gs://aie-matrix-admin \
  --member="serviceAccount:${CLOUD_RUN_SA}" \
  --role=roles/storage.objectViewer 2>/dev/null || \
  echo "   INFO: binding already present or skipped"
echo ""

# ── Phase 6: GCP Backend Bucket (Intermedium only) ───────────────────────────

echo "── Phase 6: GCP Backend Bucket (Intermedium) ───────────────────────────"
if exists_backend_bucket intermedium-backend; then
  echo "   SKIP: intermedium-backend already exists"
else
  gcloud compute backend-buckets create intermedium-backend \
    --gcs-bucket-name=aie-matrix-intermedium \
    --enable-cdn \
    --project="$PROJECT"
  echo "   OK: intermedium-backend created (CDN enabled)"
fi
echo ""

# ── Phase 7: Cloud Run admin-frontend service ─────────────────────────────────

echo "── Phase 7: Cloud Run admin-frontend ───────────────────────────────────"
if exists_cloud_run admin-frontend; then
  echo "   SKIP: admin-frontend Cloud Run service already exists"
  echo "   To update image: gcloud run deploy admin-frontend --image=$ADMIN_IMAGE --region=$REGION"
else
  gcloud run deploy admin-frontend \
    --image="$ADMIN_IMAGE" \
    --region="$REGION" \
    --allow-unauthenticated \
    --execution-environment=gen2 \
    --add-volume=name=admin-bucket,type=cloud-storage,bucket=aie-matrix-admin \
    --add-volume-mount=volume=admin-bucket,mount-path=/usr/share/nginx/html \
    --service-account="$CLOUD_RUN_SA" \
    --port=8080 \
    --project="$PROJECT"
  echo "   OK: admin-frontend Cloud Run service deployed"
fi
echo ""

# ── Phase 8: Serverless NEG and backend service ───────────────────────────────

echo "── Phase 8: Serverless NEG and Backend Service ─────────────────────────"
if exists_neg admin-frontend-neg; then
  echo "   SKIP: admin-frontend-neg NEG already exists"
else
  gcloud compute network-endpoint-groups create admin-frontend-neg \
    --region="$REGION" \
    --network-endpoint-type=serverless \
    --cloud-run-service=admin-frontend \
    --project="$PROJECT"
  echo "   OK: admin-frontend-neg created"
fi

if exists_backend_service admin-backend-service; then
  echo "   SKIP: admin-backend-service already exists"
else
  gcloud compute backend-services create admin-backend-service \
    --global \
    --project="$PROJECT"
  gcloud compute backend-services add-backend admin-backend-service \
    --global \
    --network-endpoint-group=admin-frontend-neg \
    --network-endpoint-group-region="$REGION" \
    --project="$PROJECT"
  echo "   OK: admin-backend-service created with admin-frontend-neg backend"
fi
echo ""

# ── Phase 9: Load Balancer ───────────────────────────────────────────────────

echo "── Phase 9: Load Balancer ──────────────────────────────────────────────"
if exists_url_map aie-matrix-frontend; then
  echo "   SKIP: url-map aie-matrix-frontend already exists"
  echo "   Re-importing url-map.yaml to apply any host-rule updates..."
  gcloud compute url-maps import aie-matrix-frontend \
    --source="$(dirname "$0")/url-map.yaml" \
    --global --project="$PROJECT" --quiet
  echo "   OK: url-map re-imported"
else
  gcloud compute url-maps create aie-matrix-frontend \
    --default-backend-bucket=intermedium-backend \
    --project="$PROJECT"
  gcloud compute url-maps import aie-matrix-frontend \
    --source="$(dirname "$0")/url-map.yaml" \
    --global --project="$PROJECT"
  echo "   OK: url-map created"
fi

if exists_cert aie-matrix-frontend-cert; then
  echo "   SKIP: ssl-certificate aie-matrix-frontend-cert already exists"
else
  gcloud compute ssl-certificates create aie-matrix-frontend-cert \
    --domains=play.matrix.relateby.dev,admin.matrix.relateby.dev \
    --global --project="$PROJECT"
  echo "   OK: ssl-certificate created (provisioning takes ~15 min after DNS)"
fi

if exists_proxy aie-matrix-frontend-proxy; then
  echo "   SKIP: target-https-proxy aie-matrix-frontend-proxy already exists"
else
  gcloud compute target-https-proxies create aie-matrix-frontend-proxy \
    --url-map=aie-matrix-frontend \
    --ssl-certificates=aie-matrix-frontend-cert \
    --global --project="$PROJECT"
  echo "   OK: target-https-proxy created"
fi

if exists_rule aie-matrix-frontend-rule; then
  echo "   SKIP: forwarding-rule aie-matrix-frontend-rule already exists"
else
  gcloud compute forwarding-rules create aie-matrix-frontend-rule \
    --address=aie-matrix-frontend \
    --global \
    --target-https-proxy=aie-matrix-frontend-proxy \
    --ports=443 \
    --project="$PROJECT"
  echo "   OK: forwarding-rule created"
fi
echo ""

# ── Phase 10: DNS reminder ───────────────────────────────────────────────────

echo "── Phase 10: DNS Records (manual) ──────────────────────────────────────"
echo "   Add these A records in your DNS provider:"
echo "     play.matrix.relateby.dev  →  $IP"
echo "     admin.matrix.relateby.dev →  $IP"
echo "   Then wait ~15 min for certificate provisioning to complete."
echo ""

# ── Phase 11: IAP ────────────────────────────────────────────────────────────

echo "── Phase 11: IAP OAuth setup (manual) ──────────────────────────────────"
echo "   1. Create OAuth consent screen (Internal) in GCP Console:"
echo "      APIs & Services → OAuth consent screen"
echo ""
echo "   2. Create OAuth client ID in GCP Console:"
echo "      APIs & Services → Credentials → Create Credentials → OAuth client ID"
echo "      Application type: Web application"
echo ""
echo "   3. Enable IAP on admin-backend-service with OAuth credentials:"
echo "      gcloud compute backend-services update admin-backend-service \\"
echo "        --global \\"
echo "        --iap=enabled,oauth2-client-id=<CLIENT_ID>,oauth2-client-secret=<CLIENT_SECRET> \\"
echo "        --project=$PROJECT"
echo ""
echo "   4. Add IAP accessor binding for the first operator:"
echo "      gcloud projects add-iam-policy-binding $PROJECT \\"
echo "        --member=user:<EMAIL> \\"
echo "        --role=roles/iap.httpsResourceAccessor"
echo ""
echo "==> Setup complete. Run Phase 11 steps to finish IAP configuration."
