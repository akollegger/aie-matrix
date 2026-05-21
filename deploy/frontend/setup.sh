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

set -euo pipefail

PROJECT="${GCP_PROJECT:-aie-matrix}"
REGION="${GCP_REGION:-us-central1}"

echo "==> aie-matrix front-end infrastructure setup"
echo "    Project : $PROJECT"
echo "    Region  : $REGION"
echo ""

# ── Helper: skip if resource already exists ──────────────────────────────────

exists_address() { gcloud compute addresses describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_bucket()  { gcloud storage buckets describe "gs://$1" &>/dev/null; }
exists_backend_bucket() { gcloud compute backend-buckets describe "$1" --project="$PROJECT" &>/dev/null; }
exists_url_map() { gcloud compute url-maps describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_cert()    { gcloud compute ssl-certificates describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_proxy()   { gcloud compute target-https-proxies describe "$1" --global --project="$PROJECT" &>/dev/null; }
exists_rule()    { gcloud compute forwarding-rules describe "$1" --global --project="$PROJECT" &>/dev/null; }

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
echo ""

# ── Phase 3: CI SA permissions ───────────────────────────────────────────────

echo "── Phase 3: CI SA Permissions ──────────────────────────────────────────"
echo "   Enter the CI service account email (from GCP_SERVICE_ACCOUNT Actions secret):"
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

# ── Phase 4: IAP verification ────────────────────────────────────────────────

echo "── Phase 4: IAP Verification ───────────────────────────────────────────"
echo "   Testing IAP on backend buckets..."
gcloud compute backend-buckets create iap-test-bucket \
  --gcs-bucket-name=aie-matrix-admin --project="$PROJECT" 2>/dev/null || true
IAP_RESULT=$(gcloud compute backend-buckets update iap-test-bucket \
  --iap=enabled,oauth2-client-id=TEST,oauth2-client-secret=TEST \
  --project="$PROJECT" 2>&1 || true)
gcloud compute backend-buckets delete iap-test-bucket --quiet --project="$PROJECT" 2>/dev/null || true

if echo "$IAP_RESULT" | grep -qi "unsupported\|not supported"; then
  echo "   RESULT: IAP NOT supported on backend buckets — use Cloud Run fallback (see README Phase 5 Path B)"
  IAP_PATH="cloud-run"
else
  echo "   RESULT: IAP supported on backend buckets — use backend-bucket IAP path (see README Phase 5 Path A)"
  IAP_PATH="backend-bucket"
fi
echo "   Update deploy/frontend/README.md Phase 4 'Chosen IAP Implementation' with: $IAP_PATH"
echo ""

# ── Phase 5: Backend bucket resources ────────────────────────────────────────

echo "── Phase 5: GCP Backend Bucket Resources ───────────────────────────────"
if exists_backend_bucket intermedium-backend; then
  echo "   SKIP: intermedium-backend already exists"
else
  gcloud compute backend-buckets create intermedium-backend \
    --gcs-bucket-name=aie-matrix-intermedium \
    --enable-cdn \
    --project="$PROJECT"
  echo "   OK: intermedium-backend created (CDN enabled)"
fi

if [ "$IAP_PATH" = "backend-bucket" ]; then
  if exists_backend_bucket admin-backend; then
    echo "   SKIP: admin-backend already exists"
  else
    gcloud compute backend-buckets create admin-backend \
      --gcs-bucket-name=aie-matrix-admin \
      --project="$PROJECT"
    echo "   OK: admin-backend created (IAP applied in Phase 8)"
  fi
else
  echo "   INFO: Cloud Run fallback selected — deploy admin-frontend Cloud Run service manually (see README Phase 5 Path B)"
fi
echo ""

# ── Phase 6: Load Balancer ───────────────────────────────────────────────────

echo "── Phase 6: Load Balancer ──────────────────────────────────────────────"
if exists_url_map aie-matrix-frontend; then
  echo "   SKIP: url-map aie-matrix-frontend already exists"
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

# ── Phase 7: DNS reminder ────────────────────────────────────────────────────

echo "── Phase 7: DNS Records (manual) ───────────────────────────────────────"
echo "   Add these A records in your DNS provider:"
echo "     play.matrix.relateby.dev  →  $IP"
echo "     admin.matrix.relateby.dev →  $IP"
echo "   Then wait ~15 min for certificate provisioning to complete."
echo ""

echo "==> Setup complete. Continue with Phase 8 (IAP OAuth) in deploy/frontend/README.md"
