# Intermedium — Human Spectator Client

**Audience**: Conference attendees and observability engineers  
**Purpose**: The primary human-facing interface to the aie-matrix ghost world at AIEWF 2026.

The intermedium renders the ghost world as H3 hex geometry and provides a paired-ghost conversation panel. It demonstrates that multi-agent systems at scale are observable, navigable, and human-legible.

## Camera Stops

Navigation moves through seven discrete camera stops in two rendering regimes:

**Exterior** (deck.gl, extruded board, ghosts invisible):
| Stop | Pitch | Description |
|---|---|---|
| Global | 0° | Entire globe — board as tiny landmark (H3 R0 wireframe) |
| Regional | 0° | Region-scale context — board visible as small rectangle (H3 R4–R5) |
| Neighborhood | 45° | Board fills frame — establishing shot before entering |

**Interior** (deck.gl, flat tiles, ghosts visible):
| Stop | Pitch | Description |
|---|---|---|
| Plan | 0° | Full board overhead — ghost positions as flat circles |
| Room | 0° | Zoomed into a region — ghost identity panel (~20%) |
| Situational | 45° | 7-hex proximity cluster — ghost point clouds (~50% panel) |

**Personal** (React Three Fiber, non-geospatial, requires pairing):
| Stop | Pitch | Description |
|---|---|---|
| Personal | ~80° | Single ghost as 3D point cloud — conversation + interiority panel (~80%) |

## Running Locally

### Prerequisites

- Node.js 24 + pnpm 10
- Backend running: `pnpm dev` from repo root (world-api + Colyseus + ghost house)
- Freeplay map available at `GET /maps/freeplay?format=gram`

### Setup

```bash
# Copy env template
cp clients/intermedium/.env.example clients/intermedium/.env.local

# Edit .env.local — set the URLs for your local backend:
# VITE_COLYSEUS_URL=ws://localhost:2567
# VITE_WORLD_API_URL=http://localhost:8787
# VITE_GHOST_HOUSE_URL=http://localhost:4000
# VITE_MAP_ID=freeplay
```

### Run

```bash
cd clients/intermedium
pnpm dev
```

Open `http://localhost:5180`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_COLYSEUS_URL` | Colyseus WebSocket URL for ghost position broadcasts |
| `VITE_WORLD_API_URL` | World API HTTP base URL for map topology fetch |
| `VITE_GHOST_HOUSE_URL` | Ghost house base URL for conversation and interiority |
| `VITE_MAP_ID` | Map to load at startup (default: `freeplay`) |
| `VITE_DEV_GHOST_ID` | Bypasses pairing flow — sets ghost ID directly for local dev |

## Navigation

| Key / Action | Effect |
|---|---|
| `=` / `+` | Cycle to next stop |
| `-` | Cycle to previous stop (same as Escape) |
| `Escape` | Return to previous stop |
| Double-click tile | Zoom into that tile (Plan → Room → Situational) |
| Double-click ghost | Follow that ghost (Situational → Personal, requires pairing) |
| `Enter` | Zoom into hovered tile or ghost |

## Architecture

The intermedium is a stateless React SPA built with Vite. It consumes three backends:

| Data | Source | Protocol |
|---|---|---|
| Ghost positions | Colyseus `world_spectator` room | WebSocket (`colyseus.js`) |
| World map topology | `GET /:mapId?format=gram` | HTTP (`.map.gram` parse) |
| Paired conversation | Ghost house `/conversation/:ghostId` | HTTP polling (5s) |

**Rendering**: deck.gl (`H3HexagonLayer`, `PointCloudLayer`, `IconLayer`) for all geospatial stops. React Three Fiber (`@react-three/fiber`, `three`) for the Personal stop exclusively — the deck.gl canvas unmounts and an R3F canvas mounts in its place with a CSS fade. See [ADR-0006](../../proposals/adr/0006-personal-stop-renderer.md).

No framework code is shared with `clients/debugger/`.

## Smoke Test

1. Open `http://localhost:5180` — board renders at Plan stop within 3 s.
2. Verify ghost circles update live when ghosts are active.
3. Press `=` or `+` — cycles through stops with animated camera transitions.
4. Double-click a tile — transitions to Room stop centred on that tile.
5. `Escape` — returns to previous stop.
6. With `?ghost=<id>` appended: navigate to Personal stop — R3F scene renders ghost point cloud; conversation stub visible.
