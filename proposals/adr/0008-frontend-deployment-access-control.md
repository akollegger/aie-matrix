# ADR-0008: Front-End Deployment and Access Control

**Status:** proposed  
**Date:** 2026-05-21  
**Authors:** @akollegger

## Context

ADR-0007 defines the three-tier deployment strategy for the back-end services (Colyseus, world-api, registry, agent-host). Two browser front-ends are not yet covered:

| Front-end | Package | Audience | Purpose |
|-----------|---------|----------|---------|
| **Intermedium** | `clients/intermedium` | Public — conference spectators | Live world visualisation; read-only deck.gl + R3F scene over Colyseus WebSocket |
| **Admin** | `tools/map-editor` | Admin — operators only | Authoring and operations tool (map editor today, broader admin surface going forward); POSTs to `/maps/` and `/live/` APIs via `ADMIN_TOKEN` |

Both are Vite SPAs that produce a static `dist/` bundle with no server-side rendering. They need a hosting and access-control strategy across the same three tiers as the back-end.

The two surfaces have fundamentally different access requirements:
- Intermedium must be reachable by any attendee, unauthenticated, during the conference.
- The admin client must be restricted to a small group of operators; it calls the `/maps/` and `/live/` admin APIs and must not be publicly discoverable.

The project already targets GCP for Tier 3, providing a native option for access control: **Google Identity-Aware Proxy (IAP)**, which gates a URL at the load-balancer layer using Google Identity — no code changes required in the front-end application.

## Decision

**Host both front-ends as static assets on GCS, served via a Cloud Load Balancer with Cloud CDN, on separate backend buckets.**

- The **intermedium** backend bucket is public (allUsers storage viewer).
- The **admin** backend bucket is private; IAP is enabled on that backend with access restricted to an IAM group of authorised operators.

Both backend buckets are registered under a **single Cloud Load Balancer** (one global forwarding rule, one URL map, two backend buckets). This is a separate Load Balancer from the GKE Ingress created by ADR-0007; it serves only static content.

The URL map initially uses **path-based routing** on a single domain (e.g. `/` → intermedium, `/admin/` → admin). The same URL map supports **host-rule-based routing**, so subdomains can be assigned later (`admin.aie-matrix.example.com`, `aie-matrix.example.com`) by updating DNS records (all pointing at the same reserved static IP), the TLS certificate (wildcard or multi-SAN), and the URL map host rules — no changes to the backend buckets, IAP configuration, or CDN settings.

The three-tier breakdown:

| Tier | Intermedium | Admin |
|------|-------------|-------|
| **1 — Local dev** | `pnpm dev` (Vite dev server) | `pnpm dev` (Vite dev server) |
| **2 — Staging** | `pnpm preview` or nginx container in Compose | `pnpm preview` or nginx container in Compose |
| **3 — Production** | GCS public backend bucket + Cloud CDN | GCS private backend bucket + IAP |

### Why GCS backend buckets, not nginx in GKE

The front-ends produce a static bundle with no runtime process. Serving from GKE would require a nginx container, a Deployment, a Service, and a readiness probe — infrastructure cost with no benefit over a managed static-hosting solution. GCS backend buckets are:
- natively integrated with Cloud CDN and the global Load Balancer
- deployable independently of backend service deploys
- the correct target for IAP at the Load Balancer layer

### IAP on the admin backend

IAP is applied as a Load Balancer Backend Service attribute on the admin backend bucket. It intercepts every HTTP request, redirects unauthenticated browsers through Google OAuth, validates the resulting identity token, and then proxies the request only if the authenticated user email or Google Group is listed in the `roles/iap.httpsResourceAccessor` IAM binding.

No code changes are required in the admin application. The `ADMIN_TOKEN` used by the admin client to call the `/maps/` API is a separate credential stored in the user's local `.env` or browser localStorage — IAP is a gate on the admin UI, not a replacement for the API token.

### Staging access

Tier 2 staging does not replicate IAP (Cloud-only). The admin client is served locally via `pnpm preview` or an nginx container in the Compose stack; access is controlled by network — the staging host is not publicly reachable. The intermedium client is served the same way for local validation.

A `VITE_API_BASE_URL` environment variable (set at build time or via `.env`) points each client at the correct back-end origin:

| Tier | Intermedium / Admin `VITE_API_BASE_URL` |
|------|----------------------------------------------|
| Local dev | `http://localhost:<port>` (default) |
| Staging | `http://<staging-host>:<port>` |
| Production | `https://api.aie-matrix.example.com` |

### CI/CD

Front-end builds are added to the existing GitHub Actions workflow triggered on `v*` tag push:

1. `pnpm build` in `clients/intermedium` and `tools/map-editor`.
2. `gsutil -m rsync -r -d dist/ gs://aie-matrix-intermedium/` and `gs://aie-matrix-admin/`.
3. Cloud CDN cache invalidation for intermedium on each deploy (`gcloud compute url-maps invalidate-cdn-cache`).

No Helm chart is needed; no Kubernetes objects are added.

## Rationale

- **GCS is already an operational dependency.** Map artifacts are stored in GCS (`GCS_BUCKET`); front-end hosting adds no new vendor or operational pattern. Cloud CDN and the global Load Balancer integrate natively, enabling the CDN edge for Intermedium (latency matters for a conference) and decoupling front-end deploys from backend rolling updates.
- **IAP requires zero application code.** Applying a `roles/iap.httpsResourceAccessor` IAM binding is a one-command infrastructure change. Any alternative (Firebase Auth, OAuth2 proxy, custom JWT validation) requires code in the admin app — code that becomes a maintenance surface.
- **Separating the two backends lets us apply different access policies cleanly.** A single GCS bucket serving both apps with path-based IAP rules is possible but fragile; separate buckets are independent deployment and access-control units.
- **IAP is Google-account-only.** Conference operators already work with Google accounts (GCP console access); this is not an additional credential. Attendee-facing Intermedium is fully public and never touches IAP.
- **`ADMIN_TOKEN` remains the API-level credential for map management.** IAP gates the UI. This separation means the admin APIs could be called from curl or a future CLI with the same token, without requiring IAP credentials from a script.

## Alternatives Considered

### nginx containers in GKE

Consistent with the backend topology but adds operational weight (Deployment, HPA, Service, readiness probe) for content that has no runtime process. Scales worse than CDN edge for public traffic. Rejected.

### Firebase Hosting

Native GCP SPA hosting with built-in IAP-equivalent (Firebase Hosting + Firebase App Check or custom auth). Requires a Firebase project alongside the GCP project, adds the Firebase SDK dependency, and couples front-end access control to a separate product. No net benefit over GCS + IAP for this use case. Rejected.

### Cloud Run (nginx container)

Easier than GKE for serving static content; no cluster required. Still requires a container, build step, and revision management compared to `gsutil sync`. IAP on Cloud Run is supported but adds a redirect flow with slightly more configuration than a backend bucket. Rejected in favour of GCS.

### OAuth2 proxy sidecar (e.g., `oauth2-proxy`)

Adds a proxy container that validates Google identity tokens before forwarding to the static content server. More flexible than IAP (supports non-GCP deployments) but requires managing an extra service, client ID, and cookie secret. IAP is equivalent at Tier 3 with less operational surface. Rejected.

### Single GCS bucket, path-based routing

`gs://aie-matrix-frontend/intermedium/` and `gs://aie-matrix-frontend/admin/` under one bucket. Simpler billing, but IAP cannot be applied to a sub-path of a backend bucket — it applies at the backend level. Rejected.

### CDN-native SPA hosting (Cloudflare Pages, Netlify, Vercel)

First-reach options for SPA deployment with simple CI integration and good CDN coverage. However, each introduces a second infrastructure vendor alongside GCP, which already covers this need via GCS. Access control for the admin surface would require a platform-specific mechanism (Cloudflare Access, Netlify Identity, Vercel password protection) rather than IAP, diverging from the GCP-centric operator tooling established by ADR-0007. Rejected.

## Consequences

### What becomes easier

- **Front-end deploys are decoupled from backend deploys.** A map content change can be deployed as a GCS sync without triggering a Helm rollout.
- **Global CDN for Intermedium.** Cloud CDN serves the bundle from edge nodes close to conference attendees. No Kubernetes replica scaling needed for the visualisation client.
- **Admin client is invisible to the public internet.** IAP rejects unauthenticated requests at the load balancer before they reach GCS. No URL enumeration risk.
- **Operator onboarding is a single IAM command.** Adding a new map creator: `gcloud projects add-iam-policy-binding ... --member=user:name@domain.com --role=roles/iap.httpsResourceAccessor`.

### What becomes harder / new obligations

- **Two new GCS buckets** (`aie-matrix-intermedium`, `aie-matrix-admin`) must be provisioned. Bucket names are globally unique — adjust naming if taken.
- **A single Cloud Load Balancer** (one global forwarding rule, one URL map, two backend buckets) must be provisioned separately from the GKE Ingress in ADR-0007. These are GCS backend buckets, not GKE backends.
- **IAP OAuth credentials**: creating an IAP-protected resource requires configuring an OAuth consent screen and client ID in the GCP project — a one-time setup step.
- **Cache invalidation on deploy**: Cloud CDN caches aggressively. The CI step must invalidate cached paths after each intermedium build, or the SPA must use content-hashed asset filenames (Vite does this by default for `assets/`; `index.html` is not hashed and must be invalidated explicitly).
- **`VITE_API_BASE_URL` must be set at build time** (Vite inlines env vars). The CI pipeline must supply the correct value per tier. Local dev relies on the Vite proxy or a `.env.local` override.
- **Staging has no IAP.** Developers testing admin client changes on staging must ensure the staging host is not publicly reachable (private VM / VPN). This is a procedural obligation, not a technical one.
- **IAP does not protect the `/maps/` API itself.** That remains guarded by `ADMIN_TOKEN` (bearer token, validated in world-api). This ADR does not change the API auth model.
- **Reversibility cost is moderate.** Migrating away from this setup requires updating CI/CD sync scripts, migrating or re-creating the IAP OAuth consent screen and client ID on the new platform, updating DNS records, and rebuilding both front-ends with a new `VITE_API_BASE_URL`. The GCS bucket contents can be transferred with `gsutil`, but the IAP configuration is GCP-specific and does not port to another vendor.

### Resolved open question

This ADR partially addresses the **Authentication and Identity** open question in `docs/architecture.md` for the operator use case: operators authenticate to the admin client via Google Identity through IAP. The broader question of IRL badge → ghost identity for attendees remains open.

## Related

| Document | Relationship |
|----------|-------------|
| [ADR-0007](0007-three-tier-deployment.md) | Defines the three-tier model this ADR extends to front-ends |
| [RFC-0008](../rfc/0008-human-spectator-client.md) | Defines the Intermedium client architecture |
| [RFC-0010](../rfc/0010-h3geojson-map-editor.md) | Defines the Map Editor product scope |
| [RFC-0013](../rfc/0013-map-management.md) | Defines `/maps/` and `/live/` APIs that the map editor calls |
