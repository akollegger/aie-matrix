# Quickstart: Intermedium — Human Spectator Client

**Feature**: 011-intermedium-client  
**Date**: 2026-04-26

## Prerequisites

- Node.js 24 + pnpm 10 (workspace monorepo)
- The backend stack running locally (world-api + Colyseus server + ghost house):
  ```bash
  pnpm dev   # from repo root — starts all servers in watch mode
  ```
- A world map loaded (the `freeplay` map must be available at `GET /maps/freeplay?format=gram`)

## Setup

### 1. Rename client directory

```bash
# From repo root
mv client clients/debugger
```

Update `pnpm-workspace.yaml` to include the new `clients/` glob:

```yaml
# pnpm-workspace.yaml
packages:
  - "clients/**"
  - "server/**"
  - "shared/**"
  # ... other packages
```

### 2. Create the intermedium package

```bash
mkdir -p clients/intermedium
cd clients/intermedium
pnpm init
```

Install dependencies:

```bash
pnpm add react react-dom deck.gl @deck.gl/layers @deck.gl/react h3-js colyseus.js @relateby/pattern
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

Add shared types:

```bash
pnpm add @aie-matrix/shared-types --workspace
```

### 3. Configure environment

Create `clients/intermedium/.env.local`:

```env
VITE_COLYSEUS_URL=ws://localhost:2567
VITE_WORLD_API_URL=http://localhost:3000
VITE_GHOST_HOUSE_URL=http://localhost:4000
VITE_MAP_ID=freeplay
# Optional: bypass pairing flow for local dev
VITE_DEV_GHOST_ID=ghost-uuid-here
```

### 4. Run the intermedium

```bash
cd clients/intermedium
pnpm dev
```

Open `http://localhost:5173` in a browser.

## Smoke Test

1. Open `http://localhost:5173` — the hex world should render within 3 seconds.
2. Verify ghost position dots appear on the hex grid (requires at least one ghost agent running).
3. Double-click a tile cluster — the view should transition to Area scale.
4. Double-click a ghost — the view should transition to Neighbor scale with the ghost's proximity cluster visible.
5. Back control (← button or `Escape`) — the view should return to the previous scale.

## Paired Ghost Test (requires pairing)

Append `?ghost=<ghostId>` to the URL with a valid ghost ID:

```
http://localhost:5173?ghost=ghost-uuid-here
```

1. Navigate to Neighbor scale — the paired ghost's thread stub should appear in the panel.
2. Navigate to Partner scale — the full conversation panel should be visible (showing the "unavailable" placeholder if the A2A conversation endpoint is not yet implemented).
3. Navigate to Ghost scale — the interiority placeholder should render with "loading…" sections for inventory, quest, and memories.

## Phaser Debugger (after rename)

The Phaser debugger continues to work unchanged under `clients/debugger/`:

```bash
cd clients/debugger
pnpm dev
```

All internal paths in the debugger are relative; the top-level rename has no effect on its code.

## Development Notes

- The intermedium has no shared framework code with the debugger. Each client is an independent Vite project.
- `VITE_DEV_GHOST_ID` sets the pairing ghost ID without going through the pairing flow — useful for testing Partner and Ghost scales locally.
- The A2A conversation panel (`ConversationThread`) renders a stub by default. When `VITE_GHOST_HOUSE_URL` is set and the ghost house exposes `GET /conversation/:ghostId/messages`, the stub is replaced with live data.
