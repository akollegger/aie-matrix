---
name: sre
description: >
  Structured SRE debugging methodology for aie-matrix production incidents.
  Use this skill whenever the user is investigating anything that is slow,
  broken, or behaving unexpectedly in production or staging — including slow
  deploys, failing health probes, high latency, unexpected restarts, memory
  pressure, or anything described as "something is wrong" or "why is X taking
  so long". Also use when writing a post-mortem or runbook entry. The skill
  enforces a disciplined observe-hypothesize-test loop rather than applying
  fixes based on intuition.
---

# SRE Debugging — aie-matrix

The goal is to find the **actual cause** before touching anything. Every fix
applied before the cause is confirmed is a guess that may waste time, mask
the real issue, or introduce new problems.

## The four golden signals

Before forming any hypothesis, collect data across all four signals. Skipping
this step is how debugging sessions turn into rabbit holes.

| Signal | What to measure | Key commands |
|--------|----------------|--------------|
| **Latency** | How long is the slow thing actually taking? | CI job step timestamps; `kubectl logs` timing entries; `startup-complete.elapsedMs` |
| **Traffic** | Is load unusual? More maps to sync? More pods? | `kubectl top pods -n aie-matrix`; CI run history |
| **Errors** | Are there failures, not just slowness? | `kubectl describe pod …`; probe failure events; CI log grep for ERROR/FAIL |
| **Saturation** | Is any resource exhausted? CPU, memory, disk, connections? | `kubectl top nodes`; pod `FailedScheduling` events; Neo4j Aura metrics |

Collect all four **before** forming a hypothesis. A symptom that looks like
latency is often actually saturation (today's example: helm wait looked like
slow startup but was actually node scheduling — a saturation problem).

## Structured diagnosis loop

```
1. OBSERVE   — what exactly is the symptom? (duration, error message, probe state)
2. LOCATE    — which layer? (CI step, k8s scheduling, image pull, app startup, external service)
3. MEASURE   — get actual numbers for that layer before guessing
4. HYPOTHESIZE — one cause at a time, most likely first
5. TEST      — add a log or run a command that would confirm or refute it
6. CONCLUDE  — did the data confirm it? if not, discard and try the next hypothesis
7. FIX       — only after the cause is confirmed
8. RECORD    — update docs/runbook/ with what you found
```

Never skip from OBSERVE to FIX. Never apply two changes simultaneously —
you won't know which one worked.

## Layer-by-layer diagnosis for slow deploys

Work top-down through layers. Stop at the first layer where the data points
to a problem.

### Layer 1 — CI pipeline (is it the build, or the deploy?)

```bash
gh run view --job=<JOB_ID> --repo akollegger/aie-matrix 2>&1 \
  | grep -E "✓|✗|\*"
```

Note the timestamp of "Deploy server" start vs. completion. If the build
steps are fast and only "Deploy server" is slow, the problem is in k8s,
not in the build.

### Layer 2 — Kubernetes scheduling (did the pod even start?)

```bash
kubectl describe pod -n aie-matrix -l app.kubernetes.io/name=server \
  | grep -A 30 "Events:"
```

Key signals:
- `FailedScheduling: Insufficient memory` → autoscaler had to provision a node
  (this is a saturation problem, not a latency problem — fix is `maxSurge=0`)
- `Pulling image … in Xs` → image pull time
- `Readiness probe failed` → app startup is the bottleneck
- No events at all → pod hasn't been scheduled yet

### Layer 3 — Application startup (is the app itself slow?)

```bash
kubectl logs -n aie-matrix deployment/server --since=30m \
  | grep -E '"kind":"(neo4j-init|map-sync|startup-complete)"'
```

Expected healthy timings (measured 2026-06-18):
```
neo4j-init tile-h3-constraint       ~860ms
neo4j-init map-management-constraints ~850ms
neo4j-init graph-artifacts           ~360ms
map-sync-summary (10 maps, all skip)  ~425ms
startup-complete                     ~3600ms
```

If `startup-complete.elapsedMs` is large, look at which step accounts for
the gap. If `map-sync-entry` shows a high `elapsedMs` for a specific
`mapId`, that map's GCS publish or Neo4j write is the bottleneck.

### Layer 4 — External services (Neo4j, Redis, GCS)

Only investigate this layer if Layer 3 shows a specific step is slow.

- Neo4j Aura: check the Aura console for query times and connection count.
  The database is small (628 nodes, 1053 relationships as of 2026-06-18) —
  query volume is not the issue; connection latency or cold-start usually is.
- GCS: map sync writes are small (88K total). A single PUT should be <1s.
  If it's slow, check GCS quota or network path from the GKE node.
- Redis: `makeRedisPublishLayerFromEnv` and `makeRedisGhostStoreLayerFromEnv`
  are both awaited during startup.

## Probe failures

The server has two probes with different purposes:

| Probe | Path | Passes when |
|-------|------|-------------|
| Liveness | `/ping` | Process is alive (always fast) |
| Readiness | `/health` | `spectatorMetaReady = true` (after full startup) |

A liveness failure that keeps recurring means the process is hung or OOM-killed.
A readiness failure during startup is expected — it clears once startup completes.
A readiness failure on a running pod means something regressed in `spectatorMetaReady`
logic (check recent changes to `server/src/index.ts`).

```bash
kubectl describe pod -n aie-matrix -l app.kubernetes.io/name=server \
  | grep -E "Liveness|Readiness|Unhealthy"
```

## Known issues (runbook index)

Check `docs/runbook/` before spending time on a known problem:

- **[deploy-performance.md](../../../../docs/runbook/deploy-performance.md)** —
  slow helm upgrade caused by GKE autoscaler node provisioning; fix is `maxSurge=0`

## After the incident

Every non-trivial incident gets a runbook entry. Minimum content:

```markdown
## Symptom
What the on-call person saw.

## Root cause
Why it happened. Include the date it was first found.

## Fix / remediation
Copy-pasteable commands.

## How to confirm resolved
The check that tells you it's fixed.

## Related
Links to code, charts, or other runbooks.
```

Add a row to `docs/runbook/README.md` when you add a new runbook.
