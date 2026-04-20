# IC-006: Ghost MCP `exits` Response Schema

**Contract ID**: IC-006  
**Feature**: 005-h3-coordinate-system  
**Status**: Draft  
**Consumers**: Ghost agents (`go` tool input validation), `ghosts/tck`, any ghost client that parses `exits` output

---

## Summary

The `exits` MCP tool response is extended to include named non-adjacent exits (elevators, portals) alongside the existing compass-direction neighbors. The response remains a text-formatted list but the underlying data structure and TCK expectations change.

---

## Current Behavior

`exits` returns a text list of compass directions with adjacent neighbor tileIds:

```
Available exits from 5,3:
  n → 5,2 (Blue)
  ne → 6,3 (Green)
  se → 6,4 (Blue)
```

---

## New Behavior

`exits` returns compass neighbors (using H3 index as position identity) and any named non-adjacent exits:

```
Available exits from 8f2830828052d25:
  n → 8f2830828052d2d (Blue)
  ne → 8f2830828052d29 (Green)
  se → 8f2830828052d21 (Blue)
  [elevator] elevator-b → 8f283082a992d25 (Lobby)
  [portal] pentagon-1 → 8f00000000000005 (Portal)
```

---

## Internal Data Schema

The tool handler builds this object before formatting:

```typescript
interface ExitsResult {
  here: string;                              // h3Index of current cell
  compass: Partial<Record<Compass, {
    h3Index: string;
    tileClass: string;
  }>>;
  nonAdjacent: Array<{
    name: string;                            // exit label (e.g. "elevator-b")
    kind: "ELEVATOR" | "PORTAL";
    h3Index: string;                         // destination h3Index
    tileClass: string;
  }>;
}
```

---

## TCK Expectations

Ghost contract tests MUST be updated:

1. `exits` from a navigable cell returns at least one compass direction with a valid H3 index string as the destination.
2. `exits` from a cell with a named non-adjacent exit includes that exit in the output.
3. `exits` from a pentagon cell (synthetic) returns exactly 5 compass exits and at least 1 `[portal]` entry.

---

## Backward Compatibility

The text format of the `exits` response changes (tileId format changes from `"col,row"` to H3 index string). Ghost agents that parse the text output of `exits` to extract cell identifiers MUST be updated. Ghost agents that simply read the compass direction labels (`n`, `ne`, etc.) and pass them to `go` are unaffected.
