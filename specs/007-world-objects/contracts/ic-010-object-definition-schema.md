# IC-010: Item Definition Schema

**Feature**: 007-world-objects  
**Owner**: `shared/types/src/objects.ts`  
**Consumers**: `server/colyseus/src/mapLoader.ts` (sidecar parsing), `server/world-api/src/ItemService.ts` (runtime lookups), `server/world-api/src/mcp-server.ts` (inspect/take/drop response construction)

## Schema

```typescript
export interface ItemDefinition {
  /** Short display name returned by look and inspect. */
  name: string;
  /**
   * Ruleset label for PICK_UP / PUT_DOWN evaluation.
   * Colon-separated multi-label for compound taxonomy: e.g. "Key" or "Badge:Sponsor".
   * Each colon-separated segment becomes a Neo4j node label.
   */
  itemClass: string;
  /** Whether take is permitted for this object. */
  carriable: boolean;
  /** Capacity units consumed on the host tile. 0 = no capacity impact. */
  capacityCost: number;
  /** Full text returned by inspect. Omitting means inspect returns name only. */
  description?: string;
  /**
   * Open-ended authoring attributes. Omit when empty.
   * Neo4j loader maps each key as `attr_<key>` on the ObjectInstance node.
   */
  attrs?: Record<string, string | number>;
}

/** Keyed by itemRef. The itemRef does not appear inside the record. */
export type ItemSidecar = Record<string, ItemDefinition>;
```

## Sidecar File Convention

- Path: `maps/<scene>/<mapname>.items.json`
- Format: `ItemSidecar` (plain JSON object)
- Missing file: not a startup error — map has no items
- Malformed JSON: startup error (server refuses to start)
- Unknown itemRef in `objects` tile property: startup warning, object skipped

## Validation Rules

- `name` must be a non-empty string
- `itemClass` must be a non-empty string
- `carriable` must be a boolean
- `capacityCost` must be a non-negative integer
- `description` is optional; omit rather than setting to `""` or `null`
- `attrs` is optional; omit rather than setting to `{}`; values must be `string` or `number`
