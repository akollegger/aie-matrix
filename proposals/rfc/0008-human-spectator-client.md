# RFC-0008: Intermedium — Human Spectator Client

**Status:** draft  
**Date:** 2026-04-25  
**Authors:** @akollegger  
**Related:** [RFC-0004](0004-h3-geospatial-coordinate-system.md) (H3 coordinate system),
[RFC-0005](0005-ghost-conversation-model.md) (ghost conversation model),
[RFC-0007](0007-ghost-house-architecture.md) (ghost house architecture),
[ADR-0005](../adr/0005-h3-native-map-format.md) (H3-native map format),
[ADR-0006](../adr/0006-personal-stop-renderer.md) (Personal-stop rendering stack)

## Summary

Introduce a React-based conference attendee client — `clients/intermedium/` —
as the human-facing interface to the ghost world. The intermedium renders the
ghost world as hex geometry and point-cloud ghost representations using deck.gl
(and React Three Fiber for the Personal stop), and provides a paired-ghost
conversation panel. Navigation across **seven discrete camera stops** — three
exterior (Global, Regional, Neighborhood) and four interior (Plan, Room,
Situational, Personal) — with the hex world always filling the viewport and UI
panels as overlays. This RFC also proposes renaming the top-level `client/`
directory to `clients/` and the existing Phaser client to `clients/debugger/`,
establishing a two-client structure with distinct audiences.

## Motivation

aie-matrix is not, at its core, a game. It is a live demonstration of a real
enterprise problem: how to manage and observe thousands of autonomous agents
interacting in a distributed system. The conference setting and the ghost
narrative are the medium; the message is that multi-agent systems at scale are
observable, navigable, and human-legible — if you design for it.

The intermedium is the observability interface for that system. Its camera
stops are not UX conveniences — they are observability levels:

- **Global → Regional**: fleet view — the entire agent population as a
  landmark in the world
- **Neighborhood → Plan**: establishing view — the board as physical object,
  then as playable surface
- **Room → Situational**: cluster view — activity density and the 7-agent
  proximity radius where behavior emerges
- **Personal**: agent view — one ghost's communication thread and inner state
  (goals, memories)

This is a pattern anyone building enterprise multi-agent systems will recognise.
The intermedium makes it tangible and demonstrable at AIEWF 2026.

The existing Phaser client (`clients/debugger/`) was built to verify gameplay
mechanics and remains valuable as a developer tool — raw fidelity, tile
coordinates, state dumps. It is not going away. The intermedium serves the
different audience: conference attendees who want presence and connection, and
engineers who want to see what observability looks like in a live multi-agent
system.

Four things the intermedium must provide that the debugger does not:

**A ghost-world aesthetic.** The hex grid should read as a parallel dimension,
not a game board or a spreadsheet. Wireframe geometry and point-cloud ghosts
communicate the right register: present but ethereal, structured but not
cartographic.

**A geocoded substrate.** Ghost positions are real H3 indices anchored to the
conference floor. The spectator view should make this legible — attendees with
phones should be able to orient themselves relative to where ghosts are moving.

**A conversation interface.** Each human is paired with exactly one ghost. The
ability to read and send messages to that ghost is as important as watching it
move. The interface must hold both the spatial view and the conversation at
different depths of engagement.

**Protocol fidelity.** The intermedium consumes each backend protocol for what
it is native to, rather than routing everything through a single channel. This
is both architecturally honest and demonstrably correct — the intermedium
itself is evidence that the protocol boundaries hold under real use.

## Design

### Navigation Model

The client navigates through **seven discrete camera stops** organised into two
rendering regimes. Navigation is triggered by keyboard (zoom-in / zoom-out keys
cycle through stops) or explicit UI interaction. Each stop-to-stop transition
animates zoom, pitch, and pan simultaneously using deck.gl's
`LinearInterpolator` with an easement curve. Level-of-detail changes
(extruded ↔ flat board) are hard cuts timed at the transition midpoint.

The client view state is `{ stop, focus }`:

- `stop` is one of the seven named stops below
- `focus` is `null` for fixed-center stops, or a tile H3 index / ghost ID for
  Situational and Personal

#### Exterior stops — deck.gl, extruded board, ghosts invisible

The board is rendered as an extruded `H3HexagonLayer`, giving it physical
presence in the world. Ghosts are not shown. Camera points at the board center
for all three stops.

| Stop | Pitch | Zoom scope |
|---|---|---|
| Global | 0° | Entire world in frame |
| Regional | 0° | Board visible as landmark |
| Neighborhood | 45° | Board fills frame; floor platter visible |

#### Interior stops — deck.gl, flat tiles, ghosts visible

The board switches to flat `H3HexagonLayer`. Ghosts emerge and gain
representation detail as the stop zooms in. Camera points at the board center
for Plan and Room; at the focus target for Situational.

| Stop | Pitch | Ghost repr | Requires pairing |
|---|---|---|---|
| Plan | 0° | Flat circles | No |
| Room | 0° | Flat circles | No |
| Situational | 45° | Point clouds | No |

#### Personal stop — React Three Fiber, non-geospatial

Personal breaks from the geospatial model entirely. A single ghost is framed as
a 3D subject — no H3 grid, no map coordinates. The renderer switches from
deck.gl to React Three Fiber (see [ADR-0006](../adr/0006-personal-stop-renderer.md)).
Ghost interiority (goals, memories, inventory) is displayed as ambient
annotation around the point-cloud figure.

| Stop | Pitch | Ghost repr | Requires pairing |
|---|---|---|---|
| Personal | ~80° / R3F scene | 3D point cloud | Yes |

`focus` transitions drive data subscriptions: entering Situational subscribes
to proximity events for the focused tile or ghost; entering Personal subscribes
to the paired ghost's interiority stream.

### Rendering Stack

The spatial scene is built on **deck.gl** (from the vis.gl / OpenVisualization
ecosystem), chosen because:

- H3 cell indices are the native input to `H3HexagonLayer` — no coordinate
  conversion required
- `PointCloudLayer` directly represents the ghost point-cloud aesthetic
- Ghost positions arrive from Colyseus as H3 indices (per RFC-0004) and can be
  passed to deck.gl layers without transformation
- The library runs without a map basemap in standalone mode, keeping the visual
  language in the ghost-world register rather than the cartographic register
- react-map-gl provides optional MapLibre integration if a building-footprint
  basemap is later desired

**Exterior vs interior rendering distinction.** Exterior stops (Global,
Regional, Neighborhood) render the board as an extruded `H3HexagonLayer`
(`extruded: true`) so the map reads as a physical object in the world — a
landmark rather than a flat diagram. Interior stops (Plan through Situational)
switch to flat tiles (`extruded: false`) for gameplay legibility: individual
cells, items, and ghost positions become the focus. This flip is a hard cut
timed at the midpoint of the Neighborhood → Plan transition.

**Layer composition** at full scene visibility (geospatial stops):

1. `H3HexagonLayer` — board tiles, coloured by tile type. `extruded: true` for
   exterior stops; `extruded: false`, `filled: true` for interior stops.
2. `H3HexagonLayer` (floor platter) — void cells surrounding the board,
   wireframe only, providing ground context so the board does not float in
   emptiness.
3. `PointCloudLayer` — ghost positions. Invisible at exterior stops; flat
   circles at Plan/Room; volumetric point clusters at Situational.
4. `IconLayer` — item markers on tiles with semantic content (vendor booth,
   session room, etc.)
5. Selection highlight — active tile or ghost outlined via `H3HexagonLayer`
   with a distinct stroke.

**Personal stop (React Three Fiber).** The Personal stop unmounts the deck.gl
`DeckGL` component and mounts an R3F `Canvas` in its place. The R3F scene owns
its own camera, lighting, and scene graph. No geospatial coordinate system is
involved. See [ADR-0006](../adr/0006-personal-stop-renderer.md) for the
rationale and component boundary definition.

At interior stops the deck.gl viewport responds to pan gestures. At
Situational the viewport follows the focused tile or ghost, keeping it within
the central third of the visible area.

The `docs/architecture.md` "Human spectator client" row must be updated to
list **React Three Fiber** alongside deck.gl once this RFC is accepted.

### Dual-grid context and Situational ghost behaviour

Interior stops at Room and Situational present **two** legible levels
simultaneously: a **world-scale** context layer (faint, background) and a
**local-scale** grid at the zoom of that stop. The attendee can always relate
the zoomed view to the whole-world grid.

At the **Situational** stop, when the focused ghost’s `h3Index` changes, the
ghost’s point-cloud representation does **not** translate across the map like a
sliding sprite — it remains visually anchored while the **floor cell under the
ghost** re-targets to the new H3 index. The cloud stays fixed; the terrain
advances beneath it.

### Interaction panels (overlays)

**Layout rule:** the deck.gl scene is **full width and full height** at all
geospatial stops. **Panels float on top** (anchored right, semi-opaque) — they
do **not** reallocate space away from the world the way a two-column layout
would. Exterior stops and Plan have no panel overlay. Overlay footprint grows
as stops zoom in:

| Stop | Approx. overlay footprint | Panel content |
|---|---|---|
| Global / Regional / Neighborhood / Plan | none | — |
| Room | ~20% | Public tile metadata on hover |
| Situational | ~50% | Ghost identity, current tile, proximity list; paired ghost thread if in cluster |
| Personal | ~80% (R3F scene fills remainder) | Full paired conversation thread; ghost location status readout (tile type, last move direction) **inside** the overlay — no separate mini-map column |

At Personal stop the R3F scene occupies the portion of the viewport not covered
by the overlay. Ghost interiority (goals, memories, inventory) appears as
ambient annotation within the R3F scene itself, not in the panel.

**Copy rule:** avoid “quest” / “quest log” / “memory log” in any user-facing
text. The aesthetic is **game-inspired**; the product is **not** a game.

### Ghost Interiority (Personal Stop)

The Personal stop is the only stop with no hex grid. The R3F scene presents
the ghost as a 3D subject; ghost interiority — what it carries, what it is
trying to accomplish (**goals**), and what it **remembers** — appears as ambient
annotation around the point-cloud figure, framed for **observability of an
agent**, not a player-inventory screen. The data source is the ghost's MCP
state, surfaced via the ghost house API. This is the most speculative component
— the exact data model depends on RFC-0007 ghost house implementation. It is
scoped here as a placeholder and deferred to a follow-up spec.

### Repository Structure

This RFC proposes renaming `client/` to `clients/` and reorganising the two
clients by audience:

```
clients/
  debugger/     # formerly client/phaser — developer tool, unchanged
  intermedium/  # new — conference attendee interface (this RFC)
```

The rename is a mechanical change with no impact on either client's internals.
It makes contributor intent legible at a glance: the directory name signals
that multiple clients coexist with distinct purposes, and each subdirectory
name signals its audience.

`clients/intermedium/` is a React application built with Vite, consuming shared
types from `shared/types/` as the debugger does. No framework code is shared
between the two clients — they have different rendering stacks and different
lifecycles.

### Backend Protocol Model

The intermedium is a multi-protocol client. Each data concern is served by the
protocol native to it, consistent with the role separation established in
ADR-0004 ("MCP for being in the world, A2A for acting in the community").
Colyseus is not replaced — it remains the right channel for its specific
responsibility.

| Data | Protocol | Rationale |
|---|---|---|
| Ghost positions (live broadcast) | Colyseus | Fanout to all spectators is Colyseus's native mode; neither MCP nor A2A has a broadcast primitive |
| World map and tile topology | HTTP (`GET /:mapId?format=gram`) | Static artifact endpoint per [ADR-0005](../adr/0005-h3-native-map-format.md); the intermedium parses `.map.gram` directly |
| Paired conversation thread | A2A | The ghost house already manages this via A2A; the intermedium reads the same stream |
| Ghost interiority (partner/ghost scale) | A2A or MCP | A2A push for live updates; MCP for on-demand state reads |

**Colyseus** remains the source of truth for ghost positions. Per RFC-0004
Decision 6, `ghostTiles` broadcasts H3 indices to all subscribers. The
intermedium reads these directly as deck.gl layer inputs. The `tileCoords`
backward-compatibility field (retained for the debugger) is not consumed.

**HTTP map endpoint** delivers world topology at startup — tile types, item
placements, the H3 cell graph — for rendering the hex scene. The intermedium
fetches `GET /:mapId?format=gram` from the world-api and parses the
`.map.gram` payload directly, per [ADR-0005](../adr/0005-h3-native-map-format.md).
The Phaser debugger continues to consume `format=tmj` from the same endpoint,
unchanged. No MCP tool is introduced for map topology; the static-artifact
shape fits an HTTP fetch better than a tool call, and it keeps the intermedium
free of an MCP client dependency.

**A2A conversation** is the natural fit for the paired-ghost chat panel.
RFC-0007 and ADR-0004 establish that the ghost house manages conversation
threads via A2A. The intermedium subscribes to the paired ghost's conversation
stream through the ghost house rather than through a separate channel, keeping
the protocol boundary clean. This also means the intermedium demonstrates A2A
in use from the human side, not just the agent side — a useful property for a
showcase at AIEWF 2026.

## Open Questions

1. ~~**MCP map endpoint contract.**~~ **Resolved by
   [ADR-0005](../adr/0005-h3-native-map-format.md).** Map topology is served
   over HTTP at `GET /:mapId?format=gram` as a `.map.gram` payload. No MCP
   tool is introduced.

2. **A2A conversation subscription.** The intermedium reads the paired
   conversation thread via the ghost house A2A interface. The exact mechanism —
   whether via streaming task, push notification, or a dedicated read endpoint
   — depends on how RFC-0007's ghost house exposes conversation history to
   non-agent consumers. This contract gap should be resolved with the ghost
   house team before the interaction panel is implemented.

3. **Basemap or void?** At interior stops, should the hex grid float in a dark
   void, or sit over a minimal building-footprint basemap from MapLibre? The void is more atmospheric; the basemap aids physical
   orientation for attendees on the conference floor. This is an experience
   design decision, not an architecture decision — both are straightforward
   with deck.gl. Deferred to implementation iteration.

4. **Ghost interiority data contract.** The Personal stop requires a read API
   for ghost inventory, **goal** state, and **memories**. This is not yet
   defined in RFC-0007. The Personal stop is in scope for this RFC as a
   navigation destination but its content is blocked on a follow-up contract
   with the ghost house.

5. **Pairing flow.** How does a human establish a paired ghost? Sign-up and
   pairing are mentioned in the project overview but not yet specified in an
   RFC. The intermedium needs a pairing state to gate partner/ghost scale
   access and to identify which conversation thread to subscribe to.

6. ~~**Transition animation budget.**~~ **Resolved during implementation.**
   Animated stop transitions are in scope. Camera properties (zoom, pitch, pan)
   animate simultaneously via deck.gl `LinearInterpolator` with an easement
   curve. Level-of-detail changes (extruded ↔ flat) are hard cuts at the
   transition midpoint. The Personal stop transition uses a fade-out / fade-in
   to mask the deck.gl unmount and R3F mount.

7. **Mobile layout.** The overlay footprint model is described for desktop. On
   mobile (phone), the spatial view should **dominate more aggressively**, with
   interaction UI as a pull-up drawer. Deferred — MVP targets desktop/tablet;
   same **full-bleed world** principle: panels overlay, they do not shrink the
   map canvas.

## Alternatives

**A2A-only backend.** Routing all intermedium data — positions, map, conversation
— through A2A would create a single-protocol client. A2A's task/message model
is point-to-point; it has no native broadcast primitive. Ghost position fanout
to all spectators via A2A would be O(spectators × position updates) rather than
O(1). Rejected for the broadcast case; A2A is adopted for the conversation case
where it is the natural fit. The debugger (`clients/debugger/`)
is adequate for verifying mechanics but not for the companion experience. It
has no H3-native rendering, no conversation panel, and a game-board aesthetic
that conflicts with the ghost-world register. It is retained as a developer
tool; the intermedium serves the different audience rather than replacing it.

**Three.js / React Three Fiber.** Strong for custom 3D wireframe aesthetics.
Would require building a geocoding bridge from H3 indices to scene coordinates
for geospatial stops, and has no native H3 layer primitive — the H3 integration
cost is not justified for the six stops that are geospatial. However, R3F
**is adopted** for the Personal stop, where the geospatial model is intentionally
absent and full 3D scene-graph control is required. See
[ADR-0006](../adr/0006-personal-stop-renderer.md).

**kepler.gl.** Sits on top of deck.gl and provides a complete geospatial
exploration application. Too opinionated — its UI is designed for analysts, not
conference attendees. The spectator client needs composable primitives, not a
pre-built application shell. Rejected.

**Wonderland Engine.** WebXR-first. Appropriate if the experience were AR
(holding a phone up to see ghost world overlaid on real space). Not appropriate
for a phone/desktop spectator interface without a headset. Deferred — could be
revisited if an AR mode is pursued post-AIEWF.
