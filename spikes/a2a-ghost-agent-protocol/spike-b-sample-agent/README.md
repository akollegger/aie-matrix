# Spike B — sample contributed agent

Minimal A2A agent (`@a2a-js/sdk` + Express) used with `spike-b-skeleton-house`.

## Prerequisites

- Node.js 24+
- `npm install` in this directory

## Run

```bash
PORT=4731 npm run dev
```

(`PORT` defaults to `4731`.)

## Contributor timing worksheet (SC-003)

| Step | Start (wall) | End (wall) |
|------|----------------|------------|
| Read `spike-b-skeleton-house/README.md` | | |
| `npm install` + `npm run dev` (this agent) | | |
| Register + spawn + synthetic curl (from house README) | | |

**Automated path** (developer machine, agent + house already cloned): under **15 minutes** for this repo’s smoke scripts. A true **cold contributor** wall-clock study still needs a human run — record results in `../reports/spike-b-contribution-model.md`.

## Behavior

- User text `house:spawn` → agent replies `spawn-ack` (spawn handshake for logs).
- User `data` part with `schema: "aie-matrix.spike.synthetic-world-event.v1"` → agent replies with `aie-matrix.spike.agent-response.v1` (see `specs/008-a2a-ghost-house-spike/contracts/ic-008-spike-synthetic-world-event.md`).

## Auth

None for local spike. Document as open question alongside ADR-0004.
