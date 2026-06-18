# Runbooks

Operational playbooks for diagnosing and resolving production issues.

## When to write a runbook

Write an entry the **first time you debug something non-obvious**, not speculatively.
A runbook earns its place by recording hard-won context that isn't derivable from
the code or git history — the GKE autoscaler behaviour, the probe timing that
caused a crash-loop, the manual step that unblocked a stuck deploy.

Do not write runbooks for things that are obvious from the code, covered by the
deployment checklist, or unlikely to recur.

## Minimum viable set

Three categories cover the vast majority of operational needs:

1. **Deploy & rollback** — how to ship a release, how to undo one cleanly.
   Every team needs this on day one.

2. **Alerts & incidents** — one entry per alert or failure mode that has actually
   paged someone or taken more than 30 minutes to diagnose. Include: symptom,
   root cause, remediation steps, and how to confirm it is resolved.

3. **Routine operations** — any manual procedure performed more than once:
   secret rotation, DB migrations, cache invalidation, node pool upgrades.

## Contents

| Runbook | Category | Summary |
|---------|----------|---------|
| [deploy-performance.md](deploy-performance.md) | Deploy | Slow `helm upgrade --wait` caused by GKE autoscaler node provisioning; fix and diagnosis commands |

## Format

Each runbook should have:
- **Symptom** — what the on-call person observes
- **Root cause** — why it happens (with date discovered if non-obvious)
- **Fix / remediation** — what to do, with copy-pasteable commands
- **How to confirm resolved** — so you know when to stop
- **Related** — links to code, charts, or other runbooks
