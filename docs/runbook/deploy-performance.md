# Runbook: Deploy Performance

## Symptom

`helm upgrade --wait` for the `server` chart takes 15–20 minutes, even though
the server application itself starts in under 5 seconds.

## Root cause (found 2026-06-18)

GKE's **optimize-utilization autoscaler** consolidates workloads onto the
minimum number of nodes and scales others down during idle periods. A rolling
update with `maxSurge > 0` requires scheduling the new pod while the old one
is still running. When there is no spare capacity on existing nodes, the
cluster must provision a new node before the pod can start — a 15–20 minute
operation — even though the application itself would be ready in seconds.

The server image pull is fast (~1s, ~98MB compressed). The Neo4j startup
sequence (constraints + graph seed + map sync) completes in ~3.6s. The wait
is entirely node provisioning.

## Fix applied

Set `maxSurge: 0, maxUnavailable: 1` in the server Helm chart
(`deploy/k8s/charts/server/templates/deployment.yaml`). This kills the old pod
first, then starts the new one. Trades ~4s of downtime for eliminating the
autoscaler wait.

Acceptable because:
- Single-replica Colyseus server (no distributed presence) — a second replica
  would cause "room not found" errors anyway.
- 4s downtime during a deliberate deploy is fine for this workload.

## How to diagnose a slow deploy

If a future deploy is slow, check pod events immediately after the helm step
completes:

```bash
kubectl describe pod -n aie-matrix -l app.kubernetes.io/name=server \
  | grep -A 30 "Events:"
```

Key signals:
- `FailedScheduling: Insufficient memory` → autoscaler had to provision a node
- `Pulling image … in Xs` → image pull time (unlikely to be slow, ~1s normally)
- `Readiness probe failed` repeatedly → application startup is the bottleneck

To see application startup timing from the pod logs:

```bash
kubectl logs -n aie-matrix deployment/server --since=30m \
  | grep -E '"kind":"(neo4j-init|map-sync|startup-complete)"'
```

Expected output and healthy timings:
```
{"kind":"aie-matrix.neo4j-init","step":"tile-h3-constraint","elapsedMs":~860}
{"kind":"aie-matrix.neo4j-init","step":"map-management-constraints","elapsedMs":~850}
{"kind":"aie-matrix.neo4j-init","step":"graph-artifacts","elapsedMs":~360}
{"kind":"aie-matrix.map-sync-summary","total":10,"synced":0,"skipped":10,"elapsedMs":~425}
{"kind":"aie-matrix.startup-complete","elapsedMs":~3600}
```

If `startup-complete.elapsedMs` is large, correlate against the per-step logs
to find the slow step. If `map-sync-entry` shows a high `elapsedMs` for a
specific `mapId`, that map's GCS publish or Neo4j write is the bottleneck.

## Related

- `deploy/k8s/charts/server/templates/deployment.yaml` — strategy config
- `server/src/index.ts` — startup sequence and timing logs
- GKE cluster: `aie-matrix-prod`, namespace `aie-matrix`
