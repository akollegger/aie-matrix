# A2A ghost agent protocol — spike sandbox

This directory is the **only** allowed location for throwaway code for feature **008-a2a-ghost-house-spike** (A2A Ghost House proof-of-concept).

## Rules

- Do **not** import from `packages/`, `server/`, or other production app paths.
- Do **not** add these folders to the repo-root `pnpm-workspace.yaml`.
- Each exercise lives in its own subfolder with its own `package.json` and local installs.

## Layout

| Directory | Spike | Purpose |
|-----------|--------|---------|
| `spike-a-sdk-exercise/` | A | Minimal host + agent; four SDK exercises |
| `spike-b-skeleton-house/` | B | Catalog + spawn + synthetic event |
| `spike-b-sample-agent/` | B | Contributed-style sample agent |
| `reports/` | A + B | Markdown writeups (`spec.md` FR-008) |

## Specs and proposals

- Spec: `specs/008-a2a-ghost-house-spike/spec.md`
- Plan / contracts / quickstart: `specs/008-a2a-ghost-house-spike/`
- Charter: `proposals/spikes/spike-a2a-ghost-house-poc.md`
- ADR (gated): `proposals/adr/0004-a2a-ghost-agent-protocol.md`
- RFC: `proposals/rfc/0007-ghost-house-architecture.md`

Sub-project READMEs, `package.json`, and `npm run smoke` / `npm run dev` flows are in each `spike-*` directory. Start from [`spike-a-sdk-exercise/README.md`](spike-a-sdk-exercise/README.md) (SDK) then [`spike-b-skeleton-house/README.md`](spike-b-skeleton-house/README.md) (house + curls).

Quickstart (repo-relative paths): [`specs/008-a2a-ghost-house-spike/quickstart.md`](../../specs/008-a2a-ghost-house-spike/quickstart.md).
