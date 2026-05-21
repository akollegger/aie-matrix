# Infrastructure Entity Model: Frontend Deployment and Auth

**Feature**: 017-frontend-deploy-auth

This feature introduces no application data models. The relevant entities are GCP infrastructure resources.

## GCP Resources

### GCS Buckets

| Resource | GCS Name | Access | Purpose |
|----------|----------|--------|---------|
| Intermedium bucket | `gs://aie-matrix-intermedium` | Public (`allUsers` storage viewer) | Hosts built Intermedium SPA assets |
| Admin bucket | `gs://aie-matrix-admin` | Private (no public access) | Hosts built Admin SPA assets |

### Cloud Load Balancer (new — separate from GKE Ingress)

| Resource | Name | Notes |
|----------|------|-------|
| Static IP | `aie-matrix-frontend` | Global; separate from `aie-matrix-ingress` used by GKE |
| URL map | `aie-matrix-frontend` | Host-rule routing: `play.*` → intermedium, `admin.*` → admin |
| TLS certificate | `aie-matrix-frontend-cert` | Google-managed; covers `play.matrix.relateby.dev`, `admin.matrix.relateby.dev` |
| HTTPS proxy | `aie-matrix-frontend-proxy` | Terminates TLS; references URL map |
| Forwarding rule | `aie-matrix-frontend-rule` | Port 443; references proxy |

### GCS Backend Buckets (GCP LB resource, not the GCS buckets themselves)

| Resource | GCP Name | CDN | IAP |
|----------|----------|-----|-----|
| Intermedium backend | `intermedium-backend` | Enabled | None |
| Admin backend | `admin-backend` | Disabled | Enabled (see note) |

> **Note**: IAP on `admin-backend` requires verification that `gcloud compute backend-buckets update --iap` is supported. If not, `admin-backend` is replaced by a Cloud Run backend service serving the same `gs://aie-matrix-admin` contents via nginx.

### IAP Resources

| Resource | Scope | Notes |
|----------|-------|-------|
| OAuth consent screen | GCP project | Internal (org-only); one-time setup |
| OAuth client ID | `admin-backend` backend | Stored in GCP Secret Manager; referenced in IAP config |
| IAM binding | `roles/iap.httpsResourceAccessor` on `admin-backend` | Per-operator; managed via `gcloud projects add-iam-policy-binding` |

## Relationship Diagram

```
Browser (play.matrix.relateby.dev)
  └──► Forwarding rule (aie-matrix-frontend-rule, :443)
        └──► HTTPS proxy (aie-matrix-frontend-proxy)
              └──► URL map (aie-matrix-frontend)
                    ├── play.matrix.relateby.dev ──► intermedium-backend (CDN) ──► gs://aie-matrix-intermedium
                    └── admin.matrix.relateby.dev ──► admin-backend (IAP) ──► gs://aie-matrix-admin
                                                            │
                                                            └──► IAM: roles/iap.httpsResourceAccessor
                                                                    (per-operator Google account)
```

## Existing Resources (unchanged)

| Resource | Name | Notes |
|----------|------|-------|
| GKE Ingress IP | `aie-matrix-ingress` | `matrix.relateby.dev` backend APIs + WebSocket; not modified |
| GCS bucket (maps) | `gs://aie-matrix-maps` | Map artifact storage per ADR-0007; not modified |
| CI service account | `GCP_SERVICE_ACCOUNT` secret | Gets new `roles/storage.objectAdmin` binding on the two new buckets |
