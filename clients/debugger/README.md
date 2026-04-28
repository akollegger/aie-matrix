# aie-matrix debugger

**Audience**: Developers  
**Purpose**: Developer debug tool for verifying game mechanics, tile layouts, and ghost movement in the aie-matrix world.

This client was previously located at `client/` (top-level). It was renamed to `clients/debugger/` when `clients/intermedium/` was introduced as the primary conference attendee interface.

## What it is

A Phaser-based 2D hex-tile spectator that shows raw world state: tile coordinates, ghost positions as they arrive from Colyseus, and item placements. Useful for verifying map data, testing movement rules, and debugging backend state.

This is **not** the attendee-facing interface. For the conference experience, see `clients/intermedium/`.

## Running

```bash
# From repo root
pnpm dev   # starts all servers including debugger at http://localhost:5174

# Or just the debugger
cd clients/debugger
pnpm dev
```

## Notes

- No shared framework code with `clients/intermedium/` — different rendering stacks, independent Vite projects.
- Loads maps from the same HTTP endpoint (`GET /maps/:mapId?format=tmj`) the world-api serves.
- Colyseus connection targets the same room (`world_spectator`) the intermedium uses.
