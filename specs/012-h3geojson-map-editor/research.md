# Research: H3GeoJSON Map Editor

**Feature**: `012-h3geojson-map-editor`  
**Date**: 2026-04-28

## 1. Base Map Library

**Decision**: MapLibre GL (`maplibre-gl` v5)  
**Rationale**: Already used in `clients/debugger/map-overlay`. Open-source fork of Mapbox GL JS; no API key required for OpenStreetMap tile sources. Renders a WebGL map canvas that H3 hex overlays can be drawn on as a custom layer or as GeoJSON polygon fills.  
**Alternatives considered**:
- Leaflet: simpler but SVG-based; at 5k+ hex cells performance degrades visibly
- deck.gl: used in `clients/intermedium` but optimised for data visualisation at scale, not interactive polygon drawing — higher complexity for an authoring tool
- Mapbox GL JS: requires a paid API token; rejected on cost grounds

## 2. H3 Cell Rendering on MapLibre GL

**Decision**: Use MapLibre's `addLayer` with `fill` type fed by a GeoJSON source, regenerated on state change. For each tile instance, call `h3.cellToBoundary` to obtain the hex polygon vertices and compose a GeoJSON FeatureCollection.  
**Rationale**: MapLibre already knows how to render GeoJSON polygons at 60 fps. No third-party H3 layer library is needed. The GeoJSON source is updated via `map.getSource(id).setData(...)` — MapLibre diffs the change without a full redraw.  
**Alternatives considered**:
- Canvas overlay: precise but requires manual hit-testing for click events; more code, similar performance
- deck.gl `H3HexagonLayer`: ready-made but pulls in a heavy dependency; the editor does not need deck.gl's full rendering pipeline

## 3. h3-viewer Fork Strategy

**Decision**: Copy the core H3 cell rendering and selection logic from JosephChotard/h3-viewer as a starting point, then evolve it inside `clients/map-editor/src/map/`. Do not use a git submodule.  
**Rationale**: The h3-viewer provides the hard part (H3-on-map rendering + cell hit-test). A direct copy into the monorepo means we can use pnpm workspace tooling and TypeScript compilation without submodule friction. The h3-viewer codebase is small; copying is cheaper than submodule maintenance.  
**What to take from h3-viewer**:
- Viewport-relative H3 cell enumeration (cells visible in current bounds at resolution 15)
- Cell boundary → GeoJSON polygon conversion
- Click → nearest cell centroid hit-test
**What we add**:
- Layer state model (tile / polygon / portal / item)
- Type palette panels
- Export / import pipeline

## 4. `.map.gram` Serialisation

**Decision**: Use `Gram.stringify()` from `@relateby/pattern` (`import { Gram } from "@relateby/pattern"`).  
**Rationale**: `@relateby/pattern` provides both `Gram.parse()` (gram text → Pattern AST) and `Gram.stringify()` (Pattern AST → gram text), so export and import use the same library. Export builds the Pattern AST from `MapEditorState` and calls `Gram.stringify(patterns)`, which returns `Effect.Effect<string, GramParseError>` — consistent with the project's Effect-ts usage.  
**Implementation note**: Verify during implementation that `Gram.stringify()` correctly round-trips tagged string literals (`h3\`...\``, `css\`...\``). If the Pattern AST represents them as tagged values, stringify will emit them correctly. If not, a thin post-processing step on the output string is the fallback.  
**Format notes** (from `maps/sandbox/freeplay.map.gram`):
- One node per tile instance: `(cell-{h3index}:{TypeName} { location: h3\`{h3index}\` })`
- Header block is a plain object literal
- Polygons use `[id:Polygon:{TypeName} | h3\`v1\`, h3\`v2\`, ... ]` syntax
- Portal edges: `({a})-[:Portal { mode: "{mode}" }]->({b})`

## 5. `.map.gram` Import (Parsing)

**Decision**: Use `@relateby/pattern` (already in `clients/intermedium`) for gram parsing; write a typed extraction layer on top.  
**Rationale**: `@relateby/pattern` is the canonical gram parser in this repo (IC-002 in spec-011). Reusing it avoids a second parser and keeps import behaviour consistent with how the game engine reads maps.  
**Import scope**: TileType nodes, ItemType nodes, tile instances, polygon shapes, portal relationships, item instances. Unrecognised properties are warned but do not block import.

## 6. Editor State Management

**Decision**: React `useReducer` + `Context` for MVP; no external state library.  
**Rationale**: The editor state is a single tree (MapEditorState). `useReducer` with typed actions is sufficient and adds no dependencies. If the state grows complex in future iterations, migrating to Zustand is straightforward.  
**State shape** (see `data-model.md` for full types):
```
MapEditorState
├── meta: MapMeta            # kind/name/description/elevation
├── tileTypes: TileType[]
├── itemTypes: ItemType[]
├── tileLayer: TileLayer     # Set<h3Index> + Map<h3Index, typeName>
├── polygonLayer: PolygonLayer  # committed polygons + in-progress vertices
├── portalLayer: PortalLayer # Portal[]
├── itemLayers: ItemLayer[]  # named, each with ItemInstance[]
└── ui: UIState              # activeTool, selectedLayer, visibility flags
```

## 7. Package Setup

**Decision**: `tools/map-editor` added to `pnpm-workspace.yaml`. Package name `@aie-matrix/map-editor`. Same build tooling as `clients/intermedium` (Vite 6, TypeScript 5.7, `@vitejs/plugin-react`). Placed under `tools/` alongside `tools/tmj-to-gram` — both are authoring tools that produce `.map.gram` files.  
**Dependencies**:
- `maplibre-gl` ^5
- `h3-js` ^4
- `@relateby/pattern` ^0.4 (gram import)
- `react` ^18, `react-dom` ^18
**Dev dependencies**: `vite`, `@vitejs/plugin-react`, `typescript ~5.7`, `@types/react`, `vitest`
