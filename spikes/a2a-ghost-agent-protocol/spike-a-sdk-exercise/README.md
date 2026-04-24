# Spike A — `@a2a-js/sdk` maturity exercise

Validates four patterns from `specs/008-a2a-ghost-house-spike/spec.md` (FR-001–FR-004) in one process: local Express A2A agent + in-process client (`npm run smoke`).

## Prerequisites

- Node.js 24+
- From this directory: `npm install`

## Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | `tsc` compile to `dist/` |
| `npm run smoke` | Starts ephemeral agent on random port; runs sync, stream, push (webhook), agent-card checks |

## Ports

Smoke uses **random ports** (agent + webhook). No fixed firewall rules.

## Evidence

Copy stdout (including `SPIKE_A_SMOKE_OK`) into `../reports/spike-a-sdk-maturity.md` under *What worked*.

## Notes

Console lines such as `Task … not found` may appear from the SDK during sync message handling; they did not fail the smoke run. Treat as follow-up for ADR discussion.
