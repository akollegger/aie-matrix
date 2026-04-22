# IC-010: Object Definition Schema

**Feature**: 007-world-objects  
**Owner**: `shared/types/src/objects.ts`  
**Consumers**: `server/colyseus/src/mapLoader.ts` (sidecar parsing), `server/world-api/src/ObjectService.ts` (runtime lookups), `server/world-api/src/mcp-server.ts` (inspect/take/drop response construction)

## Schema

```typescript
export interface ObjectDefinition {
  /** Short display name returned by look and inspect. */
  name: string;
  /**
   * Ruleset label for PICK_UP / PUT_DOWN evaluation.
   * Colon-separated multi-label follows the tile convention: e.g. "Key:Brass".
   */
  objectClass: string;
  /** Whether take is permitted for this object. */
  carriable: boolean;
  /** Capacity units consumed on the host tile. 0 = no capacity impact. */
  capacityCost: number;
  /** Full text returned by inspect. Omitting means inspect returns name only. */
  description?: string;
}

/** Keyed by objectRef. The objectRef does not appear inside the record. */
export type ObjectSidecar = Record<string, ObjectDefinition>;
```

## Sidecar File Convention

- Path: `maps/<scene>/<mapname>.objects.json`
- Format: `ObjectSidecar` (plain JSON object)
- Missing file: not a startup error — map has no objects
- Malformed JSON: startup error (server refuses to start)
- Unknown objectRef in `objects` tile property: startup warning, object skipped

## Validation Rules

- `name` must be a non-empty string
- `objectClass` must be a non-empty string
- `carriable` must be a boolean
- `capacityCost` must be a non-negative integer
- `description` is optional; omit rather than setting to `""` or `null`
