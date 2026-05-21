# Feature Specification: Frontend Deployment and Auth

**Feature Branch**: `017-frontend-deploy-auth`  
**Created**: 2026-05-21  
**Status**: Draft  
**Input**: User description: "frontend deployment and auth as described in @0008-frontend-deployment-access-control.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [ADR-0008](../../proposals/adr/0008-frontend-deployment-access-control.md)
- **Scope Boundary**: Production hosting for the Intermedium and Admin Vite SPAs on GCS via a Cloud Load Balancer; IAP access control on the Admin backend; CI/CD pipeline integration for automated deploys; `VITE_API_BASE_URL` wiring per tier.
- **Out of Scope**: Attendee authentication (IRL badge → ghost identity — open question in `docs/architecture.md`); authentication for the backend REST/WebSocket APIs (governed by `ADMIN_TOKEN` and existing auth); Tier 1 local dev changes; Tier 2 staging IAP replication.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Spectator Views the World (Priority: P1)

A conference attendee opens the Intermedium URL on their phone or laptop. They see the live world visualisation immediately — no login prompt, no barrier.

**Why this priority**: This is the primary public-facing surface of the project. Any friction at this step (unexpected auth redirect, slow load) directly affects the conference experience.

**Independent Test**: Navigate to the production Intermedium URL in a private browser window (no cookies). The deck.gl scene loads and connects to Colyseus without any login challenge.

**Acceptance Scenarios**:

1. **Given** an unauthenticated browser, **When** the user visits the Intermedium URL, **Then** the page loads without any authentication redirect.
2. **Given** the Intermedium page is loaded, **When** the Colyseus WebSocket connects, **Then** ghost positions and world state are rendered in the scene.
3. **Given** a new deployment of Intermedium has been pushed, **When** the user refreshes, **Then** they receive the updated build (not a stale cached version).

---

### User Story 2 — Operator Accesses the Admin Client (Priority: P1)

A map operator navigates to the Admin URL. They are redirected to Google login, authenticate with their Google account, and land on the admin interface. An unauthorized colleague who tries the same URL is denied.

**Why this priority**: IAP is the core security control of this feature. If it does not gate correctly, the admin APIs are effectively exposed to anyone who discovers the URL.

**Independent Test**: Open the Admin URL in a private browser. Verify that Google OAuth redirect occurs. Log in as an authorized operator and confirm access. Log in as an unauthorized account and confirm denial.

**Acceptance Scenarios**:

1. **Given** an unauthenticated browser, **When** the user visits the Admin URL, **Then** they are redirected to Google OAuth login.
2. **Given** a Google account that is in the IAP access list, **When** the user completes Google login, **Then** they are forwarded to the Admin client.
3. **Given** a Google account that is NOT in the IAP access list, **When** the user completes Google login, **Then** they receive a 403 access denied response.
4. **Given** an authenticated operator session, **When** the operator POSTs a map via the Admin client, **Then** the request reaches the backend API (IAP does not block API calls from the client).

---

### User Story 3 — CI/CD Deploys a New Build (Priority: P2)

A developer pushes a version tag. The GitHub Actions workflow builds both front-ends and syncs the artifacts to their respective GCS buckets. The Intermedium CDN cache is invalidated so spectators see the new build on next load.

**Why this priority**: Without automated deploy, every release requires manual `gsutil` commands — error-prone at conference pace.

**Independent Test**: Push a version tag to a branch that has a visible change in the Intermedium or Admin UI. Confirm the Actions workflow succeeds and the change is live at the production URL within the expected pipeline time.

**Acceptance Scenarios**:

1. **Given** a `v*` tag is pushed, **When** the CI workflow runs, **Then** both `clients/intermedium` and `tools/map-editor` are built with the correct `VITE_API_BASE_URL` for production.
2. **Given** a successful build, **When** the sync step runs, **Then** the dist contents are uploaded to `gs://aie-matrix-intermedium/` and `gs://aie-matrix-admin/` respectively.
3. **Given** the intermedium sync completes, **When** the cache invalidation step runs, **Then** the CDN no longer serves the previous `index.html`.
4. **Given** a failed build, **When** the CI workflow errors, **Then** no partial artifacts are synced to GCS.

---

### User Story 4 — Onboarding a New Operator (Priority: P3)

A new team member needs access to the Admin client. An existing GCP project admin runs a single `gcloud` IAM command. The new operator can immediately log in via Google — no code change, no redeployment.

**Why this priority**: Operators change. Requiring a code change or deploy to add/remove access would be a significant operational burden at the conference.

**Independent Test**: Add a new Google account to the IAP binding. Confirm that account can access the Admin URL. Remove the binding. Confirm access is denied.

**Acceptance Scenarios**:

1. **Given** a Google account not currently in the IAP access list, **When** a GCP admin runs `gcloud projects add-iam-policy-binding` with `roles/iap.httpsResourceAccessor`, **Then** that account can access the Admin URL within one minute.
2. **Given** an operator's account is removed from the IAP binding, **When** they attempt to access the Admin URL, **Then** they receive a 403 denial without any code change or redeployment.

---

### Edge Cases

- What happens if the GCS bucket sync partially fails (network interrupt mid-upload)? A partial sync leaves the bucket in a mixed state. The CI step must run `gsutil rsync` with `-d` (delete) so the bucket always reflects the full built artifact, not a blend of old and new files.
- What happens if `VITE_API_BASE_URL` is not set at build time? Vite will leave the variable undefined and API calls will fail silently or fall back to `localhost`. The CI pipeline must treat a missing `VITE_API_BASE_URL` as a build error.
- What happens if the CDN cache invalidation fails after a successful sync? Spectators may see the old `index.html` for up to the CDN TTL. The CI step should fail the workflow on invalidation error so operators are notified rather than silently serving stale content.
- What happens when a user has an active IAP session but their IAM binding is revoked? IAP token re-validation occurs on each request; access is denied on the next request after revocation propagates (typically under 60 seconds).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Intermedium build artifacts MUST be served publicly without any authentication requirement.
- **FR-002**: Admin build artifacts MUST be served only to Google accounts explicitly listed in the IAP access binding.
- **FR-003**: Unauthenticated requests to the Admin URL MUST be redirected to Google OAuth before any content is returned.
- **FR-004**: Authenticated requests from accounts not in the IAP binding MUST receive HTTP 403 (not a redirect loop).
- **FR-005**: Both front-ends MUST be deployed automatically on each `v*` version tag push via the existing GitHub Actions workflow.
- **FR-006**: Each front-end MUST deploy to its own GCS bucket so Intermedium and Admin can be updated independently.
- **FR-007**: Both front-ends MUST be built with `VITE_API_BASE_URL` pointing at the production backend origin; builds with an unset `VITE_API_BASE_URL` MUST fail.
- **FR-008**: The Cloud CDN cache for Intermedium's `index.html` MUST be invalidated after each successful sync.
- **FR-009**: Adding or removing operator access MUST require only an IAM binding change — no code change, no redeployment.
- **FR-010**: URL routing MUST support path-based routing on a single domain initially; the infrastructure MUST be capable of switching to subdomain routing via URL map configuration alone.
- **FR-011**: The single Cloud Load Balancer MUST serve both Intermedium and Admin on port 443 with TLS.

### Key Entities

- **Intermedium bucket** (`gs://aie-matrix-intermedium`): Public GCS bucket holding the built Intermedium SPA; serves as a backend bucket to the Load Balancer; Cloud CDN caches its contents.
- **Admin bucket** (`gs://aie-matrix-admin`): Private GCS bucket holding the built Admin SPA; IAP is applied at the Load Balancer backend service level.
- **Cloud Load Balancer**: Single global HTTP(S) Load Balancer with one forwarding rule, one URL map, and two backend buckets. Separate from the GKE Ingress that serves the backend APIs.
- **IAP backend config**: GCP resource that applies Google Identity authentication to the Admin backend bucket. Backed by an OAuth consent screen and client ID.
- **IAP IAM binding**: `roles/iap.httpsResourceAccessor` binding on the GCP project scoped to the Admin IAP resource; the sole access-control mechanism for the Admin surface.

### Interface Contracts

- **IC-001**: `VITE_API_BASE_URL` — build-time environment variable consumed by both SPAs to construct backend API origins. Must be set to `https://api.aie-matrix.example.com` (or the appropriate hostname) in CI for production builds. Local dev defaults to `http://localhost:<port>`.
- **IC-002**: GCS bucket public access — `gs://aie-matrix-intermedium` must have `allUsers` storage viewer binding; `gs://aie-matrix-admin` must have no public access.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A conference spectator with no prior session reaches the Intermedium client in under 3 seconds on a standard mobile connection (CDN edge serving).
- **SC-002**: An unauthorized user attempting to access the Admin URL is denied within one round-trip — no content from the Admin SPA is served before authentication is confirmed.
- **SC-003**: An authorized operator can reach the Admin client within 30 seconds of completing Google login (IAP redirect round-trip included).
- **SC-004**: A new operator can be granted Admin access within 60 seconds of the IAM binding being applied — no redeployment required.
- **SC-005**: Both front-end builds complete and sync to GCS within the existing CI/CD pipeline wall-clock budget (target: under 5 minutes added to the pipeline).
- **SC-006**: After a deployment, spectators see the updated Intermedium build on the next page load (no stale `index.html` served from CDN).

## Assumptions

- The GCP project, Artifact Registry, and GKE cluster from ADR-0007 Phase 1 already exist before this feature is provisioned.
- All operators have Google accounts already associated with the GCP project (they can access the GCP console). No new Google account provisioning is required.
- Vite's default asset fingerprinting (content-hashed filenames in `assets/`) is sufficient for CDN caching of all assets except `index.html`; only `index.html` requires explicit CDN invalidation on deploy.
- The production backend API hostname (`api.aie-matrix.example.com` or equivalent) is known and stable before the first production build; CI secrets will carry this value.
- GCS bucket names `aie-matrix-intermedium` and `aie-matrix-admin` are available globally; if taken, an operator-chosen prefix is acceptable with no other changes.
- The OAuth consent screen for IAP will be configured as "Internal" (restricted to the GCP organisation), which is appropriate for an operator-only tool.
- Tier 2 staging access is network-controlled (staging host not publicly reachable); no IAP replication in Compose is needed.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — the Decided Stack table should be extended with entries for front-end hosting (GCS + Cloud CDN) and the Admin access control (IAP). The Component Map does not currently show the front-end clients' hosting layer.
- `deploy/staging/README.md` — should document how to serve the front-ends locally during staging validation (`pnpm preview` or nginx container in Compose).
- `proposals/adr/0007-three-tier-deployment.md` — no change required; this feature extends it without contradiction.
