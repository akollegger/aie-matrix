# IC-001: Colyseus Ghost Position Consumption (Intermedium)

**Contract ID**: IC-001  
**Feature**: `011-intermedium-client`  
**Status**: Draft  
**Source Contract**: [IC-008 (spec-005)](../../005-h3-coordinate-system/contracts/ic-008-colyseus-position-broadcast.md)  
**Consumers**: `clients/intermedium/src/hooks/useColyseus.ts`

## Purpose

Documents how the intermedium subscribes to and consumes the Colyseus ghost position broadcast. This contract extends IC-008 (which defines the server-side schema change) with the intermedium-specific consumption pattern. The intermedium reads `ghostTiles` H3 index values and ignores the `tileCoords` backward-compat field — consistent with the "Map Overlay Client" pattern described in IC-008.

## Colyseus Connection

The intermedium joins the same Colyseus room as the debugger client.

```typescript
// clients/intermedium/src/services/colyseusClient.ts
import Colyseus from "colyseus.js";

const client = new Colyseus.Client(COLYSEUS_URL);
const room = await client.joinOrCreate("world_spectator");
```

**Environment variable**: `VITE_COLYSEUS_URL` (e.g., `ws://localhost:2567`)

## Consumed Schema Fields

| Field | Type | Consumed? | Usage |
|-------|------|-----------|-------|
| `ghostTiles` | `MapSchema<string>` | ✅ Yes | Key = ghostId (UUID); value = H3 res-15 index string. Passed directly to PointCloudLayer as position data. |
| `tileCoords` | `MapSchema<TileCoord>` | ❌ No | Backward-compat field for the Phaser debugger; intermedium ignores it. |
| `tileClasses` | `MapSchema<string>` | Optional | May be used to colour hex tiles by class if not loaded from gram topology. |

## Subscription Pattern

```typescript
// clients/intermedium/src/hooks/useColyseus.ts
room.state.ghostTiles.onAdd((h3Index: string, ghostId: string) => {
  updateGhostPosition({ ghostId, h3Index });
});
room.state.ghostTiles.onChange((h3Index: string, ghostId: string) => {
  updateGhostPosition({ ghostId, h3Index });
});
room.state.ghostTiles.onRemove((_value: string, ghostId: string) => {
  removeGhost(ghostId);
});
```

## Invariants

- The intermedium MUST NOT write to the Colyseus room state — it is a read-only spectator.
- The intermedium MUST NOT depend on `tileCoords` values for ghost rendering.
- Ghost positions MUST be reflected in the deck.gl PointCloudLayer within one Colyseus patch cycle (target: <1 s).

## Downstream Layer Usage

```typescript
// clients/intermedium/src/layers/ghostPointCloudLayer.ts
import { h3.cellToLatLng } from "h3-js";

function ghostsToPointCloudData(ghosts: Map<string, GhostPosition>) {
  return [...ghosts.values()].map(({ ghostId, h3Index }) => {
    const [lat, lng] = h3.cellToLatLng(h3Index);
    return { ghostId, coordinates: [lng, lat, 0] };
  });
}
```

## Contract Test Expectations

| Test | Condition | Expected |
|------|-----------|----------|
| Ghost appears | New entry in `ghostTiles` | PointCloudLayer data includes new ghost position |
| Ghost moves | `ghostTiles` entry changes value | PointCloudLayer updates within <1 s |
| Ghost leaves | `ghostTiles` entry removed | Ghost no longer rendered |
| Connection drop | Colyseus WebSocket closes | Client shows reconnecting state; positions frozen but not cleared |
