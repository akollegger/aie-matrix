# Quickstart: 008 A2A Ghost House Spike

Paths below are relative to the **repository root**.

## Prerequisites

- Node.js 24+
- `pnpm` or `npm` (each sub-project uses **local** install; repo-root `pnpm install` does **not** install spike deps)

## Where everything lives

| Path | Purpose |
|------|---------|
| `spikes/a2a-ghost-agent-protocol/` | **Only** runnable spike code |
| `spikes/a2a-ghost-agent-protocol/reports/` | Spike A / B written reports |
| `specs/008-a2a-ghost-house-spike/` | Spec, plan, contracts (this quickstart) |

## Spike A — SDK maturity (after sub-project exists)

```bash
cd spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise
npm install   # or pnpm install — local only
npm run smoke # or the script name defined in that package's README
```

Expected: console or log output proving four patterns (see `spec.md` FR-001–FR-004). Copy logs into `reports/spike-a-sdk-maturity.md`.

## Spike B — Contributor model

**House** (terminal 1):

```bash
cd spikes/a2a-ghost-agent-protocol/spike-b-skeleton-house
npm install
npm run dev   # or equivalent — see sub-project README when created
```

**Sample agent** (terminal 2):

```bash
cd spikes/a2a-ghost-agent-protocol/spike-b-sample-agent
npm install
npm run dev
```

Follow `spike-b-skeleton-house/README.md` for the **single** primary registration path (FR-005). Start wall-clock timer per `spec.md` User Story 2.

## After both spikes

1. Finalize `reports/spike-a-sdk-maturity.md` and `reports/spike-b-contribution-model.md` using FR-008 headings.
2. Prepare ADR-0004 appendix merge and RFC-0007 Open Questions cross-links (per spec **Documentation Impact**).

## Explicit non-commands

- Do not add these directories to repo-root `pnpm-workspace.yaml`.
- Do not import from `packages/*` or `server/*` inside spike sources.
