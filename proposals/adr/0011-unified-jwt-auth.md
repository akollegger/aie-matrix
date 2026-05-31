# ADR-0011: Unified JWT Authentication with OAuth 2.0 Client Credentials

**Status:** proposed  
**Date:** 2026-05-31  
**Authors:** @akollegger  
**Related:** [ADR-0001](0001-mcp-ghost-wire-protocol.md) · [ADR-0004](0004-a2a-ghost-agent-protocol.md) · [ADR-0009](0009-first-party-ghost-deployment.md) · [Constitution §V](../../.specify/memory/constitution.md)

## Context

The codebase has accumulated three distinct authentication mechanisms:

| Mechanism | Used for | Where validated |
|---|---|---|
| Ghost JWT (`Authorization: Bearer <jwt>`) | Ghost MCP calls, registry lookups | `verifyGhostToken()` in `server-auth` |
| `ADMIN_TOKEN` env var (bare shared secret) | Admin HTTP routes (`/admin/*`), `ledger_verify` MCP | `checkAdminToken()` in `world-api` |
| `GHOST_HOUSE_DEV_TOKEN` (static dev token) | Agent-host spawn/catalog calls | Agent-host middleware |

ADR-0004 explicitly deferred the credential issuance problem. ADR-0009 noted that "The auth ADR is not written" as a blocking constraint on third-party ghost deployment, and resolved it temporarily by restricting to first-party ghosts where auth collapses to intra-cluster service tokens.

The `ADMIN_TOKEN` pattern has now been called out concretely as a problem: the `ledger_verify` MCP tool (spec 022) was implemented with a separate `tryAdminAuth()` fast-path in the MCP gateway that bypasses ghost JWT validation entirely. This violates Constitution §V (MCP/A2A-First): *"Privileged operations MUST use scoped authentication through the same credential system as all other callers — no parallel auth paths for production code."*

The consequence of unresolved auth proliferation: every new privileged operation introduces another credential check pattern, the MCP gateway accumulates special-casing, and there is no coherent story for what a third-party agent presents to prove operator-level access.

## Decision

**One credential system: signed JWTs with scope claims, issued via OAuth 2.0 Client Credentials.** All callers — ghosts, operators, admin tools, and eventually third-party agents — obtain a short-lived JWT from a token endpoint using their `client_id` + `client_secret`. The JWT carries a `scopes` claim. The MCP gateway has one validation path. Privilege is a property of the token, not the transport.

**Token endpoint** — standard OAuth 2.0 Client Credentials grant ([RFC 6749 §4.4](https://datatracker.ietf.org/doc/html/rfc6749#section-4.4)):

```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>

→ 200 {
    "access_token": "<signed JWT>",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scope": "admin"
  }
```

The returned `access_token` is used for all MCP calls:

```
POST /mcp
Authorization: Bearer <access_token>
```

**Built-in clients for AIEWF 2026:**

| `client_id` | `client_secret` source | Scopes issued | Used by |
|---|---|---|---|
| `admin` | `ADMIN_CLIENT_SECRET` env var | `admin` | Operators, admin console |
| `ghost-{id}` | Issued at ghost registration | (empty) | Ghost agents |
| `agent-host` | `AGENT_HOST_CLIENT_SECRET` env var | `agent-host` | Agent-host service calls |

**`ADMIN_TOKEN` is renamed `ADMIN_CLIENT_SECRET`** to reflect its narrowed role: it is the `client_secret` for the built-in `admin` client, used only to obtain a token — never sent to domain services directly.

**Ghost JWT changes:** `verifyGhostToken()` is extended to pass the `scopes` claim from the JWT payload through to `AuthInfo.scopes`. Ghost tokens have `scopes: []` by default; admin sessions have `scopes: ["admin"]`. The scope check in each privileged tool (`scopes.includes("admin")`) is the only gate.

**`GHOST_HOUSE_DEV_TOKEN`:** Replaced by the `agent-host` client credentials for Tier 2/3. In Tier 1 local dev, remains as a convenience constant. This ADR does not address third-party agent credential issuance beyond the endpoint shape (still deferred per ADR-0009).

## Rationale

**Standard.** OAuth 2.0 Client Credentials is the industry-standard pattern for machine-to-machine auth. Any OAuth2-aware tool — Postman, curl with standard flags, any SDK — works without custom documentation. Ghost SDK authors get a familiar integration point.

**One validation path.** `verifyGhostToken()` handles every MCP request. Privilege flows from the token's scope claims. Adding a new privileged tool means adding `scopes.includes("the-scope")` in the handler, not adding a new auth mechanism.

**Extensible.** The same endpoint supports additional grant types later: `authorization_code` for human operators authenticating via browser, `urn:ietf:params:oauth:grant-type:jwt-bearer` for third-party ghost agents presenting a pre-signed assertion. Third-party credential issuance (the open question from ADR-0004) becomes "issue a `client_id`/`client_secret` to each registered external agent" — a well-understood pattern.

**Auditable.** Every action arrives via a JWT with bounded expiry, a `client_id`, `iat`, and optionally a `jti`. Bare shared secrets carry none of this.

**Minimal infrastructure.** The token endpoint lives in the existing registry server. No external identity provider needed for AIEWF 2026. The JWT signing key is the same secret already used for ghost JWTs.

## Alternatives Considered

**Keep `ADMIN_TOKEN` as a first-class MCP credential (current `tryAdminAuth()` pattern).** Rejected — permanent second auth path in the gateway, violates the constitution, no identity signal in logs.

**Bespoke bootstrap endpoint (`POST /registry/admin-session` with bare `Authorization: Bearer <ADMIN_TOKEN>`).** A valid intermediate step but non-standard. Clients can't use OAuth2 libraries; the endpoint has to be documented from scratch. The standard Client Credentials shape costs nothing extra to implement and is immediately recognizable.

**External OAuth server (Auth0, Keycloak, etc.).** Correct long-term for multi-tenant SaaS but operationally heavy for a conference deployment. The registry-hosted token endpoint gives the same interface with zero new infrastructure.

**Separate admin MCP endpoint (`/admin/mcp`).** Rejected — bespoke HTTP endpoints for domain operations are prohibited by the constitution.

**Role-per-ghost (ghost JWT with elevated claims).** Rejected — conflates ghost identity with operator privilege, makes audit logs ambiguous.

## Consequences

**Easier:**
- Every MCP tool needing privilege checks `scopes.includes(...)` — one pattern.
- New privilege tiers cost one new client registration and one scope string.
- Standard tooling works out of the box for operators and SDK authors.
- `tryAdminAuth()` fast-path in `mcp-server.ts` is deleted; the gateway simplifies.
- Third-party ghost agent credential issuance has a clear implementation path when the time comes.

**Requires follow-up work (not AIEWF 2026 blockers):**
- `POST /oauth/token` endpoint added to the registry server.
- `verifyGhostToken()` emits `scopes` from JWT claims (currently always `[]`).
- `ADMIN_TOKEN` env var renamed `ADMIN_CLIENT_SECRET` in config, docs, and CI secrets.
- Existing `checkAdminToken()` HTTP admin routes migrated to JWT path (tech debt; routes continue working on the old pattern until migrated).
- `GHOST_HOUSE_DEV_TOKEN` replaced with `agent-host` client credentials for Tier 2/3.

## Implementation Notes

The operator workflow after this ADR is implemented:

```bash
# One-time per session: exchange client credentials for a JWT
ADMIN_JWT=$(curl -s -X POST https://api.matrix.neo4j.gg/oauth/token \
  -d "grant_type=client_credentials&client_id=admin&client_secret=$ADMIN_CLIENT_SECRET" \
  | jq -r .access_token)

# All subsequent MCP calls use the JWT
pnpm ghost:cli --bearer "$ADMIN_JWT"
> ledger_verify   # works — JWT has scope: "admin"
```

Ghost agent registration flow (future third-party, same endpoint):

```bash
# Registry issues client_id + client_secret at registration time
# Ghost agent exchanges them for a JWT before connecting to MCP
POST /oauth/token
grant_type=client_credentials&client_id=ghost-abc&client_secret=<issued-secret>
→ { access_token: "<JWT scopes=[]>", expires_in: 3600 }
```
