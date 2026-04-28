# Contract: `.map.gram` Format (IC-001 / IC-002)

**Feature**: `012-h3geojson-map-editor`  
**Consumers**: game engine (server-side map loader), `tmj-to-gram` output compatibility  
**Version**: RFC-0010

A `.map.gram` file is valid UTF-8 text in gram syntax. Sections appear in order: header, tile type definitions, item type definitions, tile/polygon instances, portal relationships, item instances.

---

## 1. Header (required)

```gram
{
    kind: "matrix-map",
    name: "<identifier>",
    description: "<human-readable>",   // optional
    elevation: <integer>               // 0 = ground floor
}
```

- `kind` MUST be the literal string `"matrix-map"`
- `name` MUST be a valid gram identifier (alphanumeric + hyphens, no spaces)
- `elevation` defaults to `0` if omitted on import

## 2. Tile Type Definitions (zero or more)

```gram
(<id>:TileType:<TypeName> {
    name: "<display name>",
    description: "<text>",       // optional
    capacity: <integer>,         // optional; omit for unlimited
    style: css`<css-expression>` // optional
})
```

- `<id>` is a gram-local identifier (e.g. `carpetedFloor`)
- `<TypeName>` is the label used on tile instances (e.g. `CarpetedFloor`)
- `TileType` MUST appear as the first label after the id

## 3. Item Type Definitions (zero or more)

```gram
(<id>:ItemType:<TypeName> {
    name: "<display name>",
    description: "<text>",          // optional
    glyph: char`<unicode-char>`,
    takeable: <boolean>,
    capacityCost: <integer>,        // optional
    style: css`<css-expression>`    // optional
})
```

## 4. Tile Instances — Point (single cell)

```gram
(cell-<h3index>:<TypeName> { location: h3`<h3index>` })
```

- Node id is `cell-` prefixed with the H3 index
- `<TypeName>` MUST reference a `TileType` defined in this file
- `location` value uses the `h3` tagged string literal

## 5. Tile Instances — Polygon (filled region)

```gram
[<id>:Polygon:<TypeName> |
    h3`<vertex-1>`,
    h3`<vertex-2>`,
    h3`<vertex-3>`
]
```

- Minimum 3 vertices; order defines the boundary
- The interior cell set is derived by the consumer via `h3.polygonToCells`
- Interior cells MUST NOT be individually listed unless they override `<TypeName>`
- Override cells appear as Point instances after the polygon block

## 6. Portal Relationships (zero or more)

```gram
(<fromRef>)-[:Portal { mode: "<mode>" }]->(<toRef>)
```

- `<fromRef>` and `<toRef>` MUST resolve to existing tile instance node ids
- `mode` is an open-ended string; suggested values: `"Elevator"`, `"Stairs"`, `"Door"`, `"Teleporter"`
- Portals MAY reference the `cell-<h3index>` id form directly

## 7. Item Instances (zero or more)

```gram
(<id>:<TypeName> { location: h3`<h3index>` })
```

- `<id>` is unique within the file
- `<TypeName>` MUST reference an `ItemType` defined in this file
- `location` cell MUST exist in the tile layer

---

## Tagged String Literals

| Tag | Meaning | Example |
|---|---|---|
| `h3\`...\`` | H3 cell index (resolution 15) | `h3\`8f283082aa20c00\`` |
| `css\`...\`` | CSS expression | `css\`background: #c8b89a\`` |
| `url\`...\`` | File or resource path | `url\`maps/moscone/west.map.gram\`` |
| `char\`...\`` | Single Unicode character | `char\`🔑\`` |

---

## Compatibility Notes (IC-002)

Files produced by `tmj-to-gram` are valid import targets. Known divergences:
- `tmj-to-gram` output does not include polygon shape blocks; all cells are Point instances — this is valid and imports correctly
- `tmj-to-gram` may emit `color:` instead of `style:` on type definitions — import SHOULD treat `color: css\`...\`` as equivalent to `style: css\`...\``
- Unrecognised properties on any node MUST be preserved as-is through a round-trip and reported as a warning to the author
