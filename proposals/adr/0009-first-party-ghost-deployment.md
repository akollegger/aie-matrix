# ADR-0009: First-Party Ghost Deployment for Initial Release

**Status:** proposed  
**Date:** 2026-05-22  
**Authors:** @akollegger  
**Related:** [ADR-0004](0004-a2a-ghost-agent-protocol.md) · [ADR-0007](0007-three-tier-deployment.md) · [RFC-0007](../rfc/0007-ghost-house-architecture.md) · [Spec 018](../../specs/018-ghost-agent-deployment/spec.md)

## Context

ADR-0004 established A2A as the ghost agent protocol and defined a third-party
contribution model: external teams implement a ghost agent at their own endpoint,
register an agent card with the agent host catalog, and the host spawns and
supervises their agent. That model was designed for long-term extensibility beyond
AIEWF 2026.

Two constraints block the third-party model for the initial release:

**The auth ADR is not written.** ADR-0004 explicitly defers the credential flow
for non-local agent endpoints to a follow-up ADR, and states that the static dev
token (`GHOST_HOUSE_DEV_TOKEN`) *must not be used outside localhost deployments*.
Without a production auth mechanism, no external agent endpoint can be safely
admitted to the staging or production environment.

**External endpoints add deployment complexity.** Third-party agent URLs introduce
NAT traversal, TLS termination, reachability monitoring, and versioning concerns
that are operationally significant at a conference with a fixed deadline. The agent
host would need to handle unreachable endpoints, authentication failures, and
version mismatches from sources outside the team's control.

There is a simpler path: all ghost agents for AIEWF 2026 are built in the same
repo, containerized alongside the other services, and deployed into the same
cluster. The auth problem collapses to intra-cluster communication (no external
credential issuance needed). Deployment complexity collapses to the same Docker /
Kubernetes patterns already established for world-api and Colyseus.

The behavioral tier model (Wanderer → Social) from ADR-0004 is unaffected — tiers
describe what a ghost *does*, not where it runs.

## Decision

For the AIEWF 2026 release, **all ghost agents are first-party**: built from the
`ghosts/` directory of the aie-matrix monorepo, containerized using the same
multi-stage Dockerfile pattern as other services, and deployed as Kubernetes
Deployments into the same cluster as the agent host.

The third-party contribution model from ADR-0004 is explicitly **deferred**, not
abandoned. The behavioral tier conformance model (Wanderer / Listener / Social),
the A2A protocol wire format, and the agent card schema are unchanged — the
deferral is purely a deployment scope decision.

**Mechanics of first-party ghost deployment:**

Each ghost package in `ghosts/<name>/` follows a standard lifecycle across the
three deployment tiers established in ADR-0007:

| Tier | How the ghost runs |
|---|---|
| **Tier 1 (local dev)** | `pnpm dev` in the package directory; connects to a locally running agent-host and world-api |
| **Tier 2 (staging compose)** | Container built from `ghosts/<name>/Dockerfile`; added to `docker-compose.yml` after agent-host |
| **Tier 3 (production GKE)** | Kubernetes `Deployment` in the same cluster as agent-host; scaled independently |

**Self-registration on startup.** Ghost containers are stateless. On startup, each
ghost calls the agent host's catalog API (`POST /v1/catalog/register`) with its
agent card, including a `url` field set to `AGENT_SELF_URL` (the address at which
the agent-host can reach this instance). The agent-host catalog is not pre-seeded
with ghost definitions; it is populated entirely by self-registration. This
preserves the same registration contract that third-party agents would use, keeping
the path open for future external contributors.

**Replica identity.** When a ghost Deployment is scaled to multiple replicas, each
replica self-registers independently with its own `AGENT_SELF_URL` (typically the
pod IP or a replica-specific DNS name). The agent-host catalog treats each
registration as a distinct schedulable agent instance and load-balances ghost
adoption requests across available instances.

**Auth for intra-cluster communication.** First-party ghosts and the agent-host
run in the same cluster. The Phase 1 `GHOST_HOUSE_DEV_TOKEN` static bearer
mechanism (permitted for localhost by ADR-0004) is extended to intra-cluster
communication in Tier 2 and Tier 3 under the following constraint: the token is
injected via Kubernetes Secret and never logged or exposed outside the cluster
network. This remains explicitly sub-production and must be replaced by the
follow-up auth ADR before any external agent endpoints are admitted.

The pattern for adding a first-party ghost is documented in Spec 018.

## Rationale

**Eliminates the blocking auth dependency.** ADR-0004 explicitly gates non-local
third-party deployment on an auth ADR. That ADR is not written and is not planned
for AIEWF 2026. The first-party model collapses "external endpoint auth" to
"intra-cluster service token" — a problem the existing `GHOST_HOUSE_DEV_TOKEN`
already solves at the cost of being a static secret, which is acceptable for
intra-cluster, time-boxed conference infrastructure.

**Same-repo ghosts are deployable with existing tooling.** The multi-stage
Dockerfile and `docker-compose.yml` patterns from Spec 016 require no new
infrastructure knowledge. A ghost package follows the same build / health-check /
env-var conventions as world-api and Colyseus. The cognitive overhead for operators
is near zero.

**Self-registration preserves the third-party path.** Requiring each ghost to call
`POST /v1/catalog/register` on startup — rather than baking ghost definitions into
the agent-host — means the catalog API remains the authoritative registration
surface. A future third-party agent uses exactly the same API, with only the auth
mechanism changing. There is no re-architecture required to re-enable external
contributions.

**Behavioral tiers remain valid.** Whether a ghost is first-party or third-party
is invisible to the TCK. A first-party Wanderer agent and a future third-party
Wanderer agent are evaluated identically. The tier system is still the contribution
contract; this ADR merely narrows who can contribute to the initial release.

## Alternatives Considered

**Proceed with third-party model and write the auth ADR first.** This would unblock
external contributions but adds a non-trivial design and implementation task
(credential issuance, OAuth or API-key flow, agent-host validation logic) to an
already tight timeline. The risk of a half-finished auth system at conference time
outweighs the benefit of an open contribution surface that, in practice, only the
core team is likely to use for AIEWF 2026.

**Embed ghosts inside the agent-host process.** Running ghost logic in-process with
the agent-host eliminates the A2A network hop and removes the need for per-ghost
containers. The cost: ghosts are no longer independently deployable or scalable,
and the A2A protocol wire is not exercised end-to-end. The current architecture
already validates A2A with the spike (spike-008); regressing to in-process would
eliminate that validation and couple ghost code to agent-host internals.

**Pre-seed the agent-host catalog from a config file.** Rather than self-registration,
the agent-host could read a `ghosts.json` manifest listing built-in agents. This
is simpler per-startup but requires the agent-host to know about specific ghost
packages at build time, coupling them. Self-registration keeps agent-host unaware
of which ghosts exist until they announce themselves, which is the correct
abstraction boundary.

## Consequences

**Easier:**
- Ghost agents are deployable with the same toolchain as all other services; no
  new infrastructure patterns for operators
- Adding a new first-party ghost is a repeatable operation (follow Spec 018)
- The agent-host catalog API is exercised by real traffic from day one, making the
  future third-party onboarding path easier to validate
- Intra-cluster auth is a solved problem; no credential issuance infrastructure needed
- `random-agent` becomes the worked example for the Spec 018 deployment pattern

**Harder:**
- Each new ghost type requires a new package in `ghosts/`, a Dockerfile, and
  entries in the compose file and K8s manifests — more files to maintain than an
  in-process approach
- Scaling ghost replicas requires understanding that each replica self-registers
  independently; the catalog may temporarily show stale entries if a replica dies
  before deregistering
- The static `GHOST_HOUSE_DEV_TOKEN` is a credential that must be rotated before
  any external party gains access to staging infrastructure; requires a clear note
  in the operational runbook

**Deferred:**
- Third-party ghost contribution (external endpoints, auth credential flow) —
  blocked on the follow-up auth ADR; target: post-AIEWF
- Agent sandbox hosting (running third-party code without requiring their own
  infrastructure) — flagged as open in RFC-0007, still open
