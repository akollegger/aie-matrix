# IC-011: MCP Object Tool Schemas

**Feature**: 007-world-objects  
**Owner**: `server/world-api/src/mcp-server.ts`  
**Type definitions**: `shared/types/src/ghostMcp.ts`, `shared/types/src/objects.ts`  
**Consumers**: Ghost agents (LLM-driven or scripted), ghost-cli, random-house, ghost-ts-client

---

## Extended: `look`

No new input arguments. All existing call patterns unchanged.

**Response extension** — `TileInspectResult` gains an optional `objects` field:

```typescript
interface TileItemSummary {
  id: string;     // itemRef (sidecar key)
  name: string;   // ItemDefinition.name
  at: "here" | "n" | "s" | "ne" | "nw" | "se" | "sw";
}

interface TileInspectResult {
  tileId: string;
  tileClass: string;
  occupants: string[];
  objects?: TileItemSummary[];  // present when ≥1 object visible; absent when none
}
```

The `at` field is `"here"` when the object is on the ghost's current tile. For `look { at: "around" }`, each neighbor's objects carry the compass face that tile is at. For `look { at: "<face>" }`, items on that tile carry `"here"` (the tile is the focal tile).

**Example** — `look { at: "here" }` when ghost is on a tile with a sign, and the northeast tile has a key:
```json
{
  "tileId": "8f2830828ffffff",
  "tileClass": "Green",
  "occupants": ["ghost-42"],
  "objects": [
    { "id": "sign-welcome", "name": "Welcome Board", "at": "here" },
    { "id": "key-brass", "name": "Brass Key", "at": "ne" }
  ]
}
```

---

## New: `inspect`

```typescript
// Input
interface InspectArgs {
  itemRef: string;  // sidecar key
}

// Success
interface InspectSuccess {
  ok: true;
  name: string;
  description?: string;  // omitted when definition has no description
}

// Failure
interface InspectFailure {
  ok: false;
  code: "NOT_HERE" | "NOT_FOUND";
  reason: string;
}

type InspectResult = InspectSuccess | InspectFailure;
```

**Precondition**: The ghost must be on the same tile as the object.  
**Failure codes**:
- `NOT_HERE` — object exists in the sidecar but is not on the ghost's current tile
- `NOT_FOUND` — itemRef does not exist in the sidecar

---

## New: `take`

```typescript
// Input
interface TakeArgs {
  itemRef: string;
}

// Success
interface TakeSuccess {
  ok: true;
  name: string;  // ItemDefinition.name for confirmation
}

// Failure
interface TakeFailure {
  ok: false;
  code: "NOT_CARRIABLE" | "NOT_HERE" | "NOT_FOUND" | "RULESET_DENY";
  reason: string;
}

type TakeResult = TakeSuccess | TakeFailure;
```

**Preconditions**: Object on ghost's current tile; `carriable: true`; ruleset permits (when loaded).  
**Failure codes**:
- `NOT_CARRIABLE` — object exists on tile but `carriable: false`
- `NOT_HERE` — itemRef in sidecar but not on this tile
- `NOT_FOUND` — itemRef not in sidecar
- `RULESET_DENY` — RFC-0002 PICK_UP rule denied the action (stub in PoC; always passes when no ruleset loaded)

---

## New: `drop`

```typescript
// Input
interface DropArgs {
  itemRef: string;
}

// Success
interface DropSuccess {
  ok: true;
}

// Failure
interface DropFailure {
  ok: false;
  code: "NOT_CARRYING" | "TILE_FULL" | "RULESET_DENY";
  reason: string;
}

type DropResult = DropSuccess | DropFailure;
```

**Preconditions**: Ghost is carrying the object; dropping it will not exceed tile's effective capacity.  
**Failure codes**:
- `NOT_CARRYING` — ghost is not carrying an item with this itemRef
- `TILE_FULL` — `capacityCost` of object would push tile's `ghostCount + objectCosts` above `tile.capacity`
- `RULESET_DENY` — RFC-0002 PUT_DOWN rule denied (stub; always passes when no ruleset loaded)

---

## New: `inventory`

```typescript
// No input arguments

// Response (always ok: true)
interface InventoryResult {
  ok: true;
  objects: Array<{
    itemRef: string;
    name: string;
  }>;
}
```

Returns an empty `objects` array when the ghost carries nothing. Never fails.

---

## Tool Registration Order

New tools are added after `inbox` in `buildGhostMcpServer()`:

```
whoami, whereami, look, exits, traverse, go, say, bye, inbox, inspect, take, drop, inventory
```

`GHOST_MCP_TOOLS` constant in `shared/types/src/ghostMcp.ts` updated accordingly.
