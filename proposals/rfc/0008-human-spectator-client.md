# RFC-0008: Intermedium — Human Spectator Client

**Status:** draft  
**Date:** 2026-04-25  
**Authors:** @akollegger  
**Related:** [RFC-0004](0004-h3-geospatial-coordinate-system.md) (H3 coordinate system),
[RFC-0005](0005-ghost-conversation-model.md) (ghost conversation model),
[RFC-0007](0007-ghost-house-architecture.md) (ghost house architecture),
[ADR-0005](../adr/0005-h3-native-map-format.md) (H3-native map format)

## Summary

Introduce a React-based conference attendee client — `clients/intermedium/` —
as the human-facing interface to the ghost world. The intermedium renders the
ghost world as wireframe hex geometry and point-cloud ghost representations
using deck.gl, and provides a paired-ghost conversation panel. Navigation
between five discrete zoom scales — Map, Area, Neighbor, Partner, and Ghost —
sets an **effective** scene:panel ratio (how much of the view the UI panels
**cover** as **overlays**). The H3 / deck.gl world **always fills the viewport**
from Map through Partner; panels are not a flex side column that shrinks the
canvas. This RFC also proposes renaming the top-level `client/`
directory to `clients/` and the existing Phaser client to `clients/debugger/`,
establishing a two-client structure with distinct audiences.

## Motivation

aie-matrix is not, at its core, a game. It is a live demonstration of a real
enterprise problem: how to manage and observe thousands of autonomous agents
interacting in a distributed system. The conference setting and the ghost
narrative are the medium; the message is that multi-agent systems at scale are
observable, navigable, and human-legible — if you design for it.

The intermedium is the observability interface for that system. Its five zoom
scales are not UX conveniences — they are observability levels:

- **Map scale**: fleet view — the entire agent population at a glance
- **Area scale**: cluster view — activity density and movement patterns in a region
- **Neighbor scale**: interaction view — the 7-agent proximity radius where behavior emerges
- **Partner scale**: agent view — one agent's communication thread
- **Ghost scale**: interiority view — one agent's memory, goals, and state

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

The client maintains a top-level view state `{ scale, focus }`:

- `scale` is one of: `map | area | neighbor | partner | ghost`
- `focus` is `null` at map scale, a region identifier at area scale, or a
  ghost ID at neighbor/partner/ghost scale

Navigation is **discrete** — each scale is a named mode with its own layout
and data subscriptions, not a continuous zoom level. Transitions are animated
but MVP may treat them as instant cuts. Navigation is triggered by explicit
user interaction (double-click on a ghost or tile cluster to zoom in;
back-control or keyboard shortcut to zoom out).

The five scales accumulate both spatial intimacy and information access:

| Scale | Spatial focus | Scene:Panel (overlay footprint) | Info access | Requires pairing |
|---|---|---|---|---|
| Map | Entire world | 100:0 | Public tile metadata (hover) | No |
| Area | Browsable section (full-bleed) | ~80:20 | Public + ghost identity in **right overlay** | No |
| Neighbor | 7-hex cluster (full-bleed) | ~50:50 | Public interactions + paired thread in **overlay** | Partial |
| Partner | Full world under glass | ~20:80 | Private conversation in **large overlay**; **no** separate mini-map strip (status + thread in overlay) | Yes |
| Ghost | (no map) | 0:100 | **Inventory, active goal, memories** (observability copy, not RPG-quest) | Yes |

`focus` transitions drive data subscriptions: entering neighbor scale for a
ghost subscribes to that ghost's 7-hex proximity events; entering partner scale
subscribes to the paired conversation thread.

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

**Layer composition** at full scene visibility:

1. `H3HexagonLayer` — wireframe hex grid, `filled: false`, coloured by tile
   type. Filled variant for tiles with semantic content (vendor booth, session
   room, etc.)
2. `PointCloudLayer` — one point cluster per ghost. **Map–Neighbor:** positioned
   at H3 **cell centroids** (2D, with size scaled by proximity to focus).
   **Partner (paired ghost):** **3D** volume in view space, per `spec.md` **FR-025** (not a
   gliding 2D dot across the map; floor cell updates under a fixed cloud).
3. Marker overlays — items on tiles rendered as simple icon sprites via
   `IconLayer`
4. Selection highlight — active ghost or cluster outlined via `H3HexagonLayer`
   with distinct stroke

At area scale and below, the deck.gl viewport responds to pan gestures. At
neighbor scale and above, the viewport lazily follows the focused ghost,
keeping it within the central third of the visible area (until Partner-specific
framing; see `specs/011-intermedium-client/spec.md` FR-015, FR-024, FR-025).

### Camera zoom, dual grid, and Partner 3/4 (spec FR-024 – FR-025)

Each **scale** is not just an overlay size — it is a **zoom level** on the H3
grid. **Area, Neighbor, and Partner** present **two** legible levels: a
**world-scale** context (faint, inset, or background) and a **local-scale** grid
at the zoom of that mode (region, 7-hex cluster, or **single cell**). **Partner**
is special: the scene is **one H3 cell** (the cell the paired ghost stands on);
the camera moves to a **high 3/4** (oblique) view — the point at which
perspective may **diverge** from strict overhead. The **paired ghost** is a
**3D point cloud**. When the ghost’s real `h3Index` changes, the **cloud stays
fixed** in the Partner view; the **cell under the ghost** **re-targets** to the new
index (the underfoot floor advances, not a sliding point cloud across the map).

### Interaction panels (overlays)

**Layout rule:** the deck.gl scene is **full width and full height** at Map, Area, Neighbor, and Partner. **Panels float on top** (typical: anchored right, semi-opaque) with a footprint that matches the nominal scene:panel ratio — they do **not** reallocate main-axis space away from the world the way a two-column app shell would. Map scale has no panel overlay. Content is scale-dependent:

- **Area**: Public info about hovered or selected ghost (name, class, current
  tile type). No conversation.
- **Neighbor**: Public activity feed for the 7-hex cluster. If a paired ghost
  is within the cluster, their conversation thread is appended below.
- **Partner**: Full conversation thread with the paired ghost, inside the
  Partner overlay. Ghost location is a minimal **status** readout (tile type,
  last move direction) in the **same overlay** — **not** a second narrow
  “mini-map” column beside the thread.
- **Ghost**: Interiority view — **inventory**, **active goal** summary, and
  **memories** (avoid “quest” / “quest log” / “memory log” in user copy; the
  aesthetic is **game-inspired**, the product is **not** a game). No map. No
  conversation input (read-only at this scale).

### Ghost Interiority (Ghost Scale)

The ghost scale is the only scale with no hex grid. It presents the ghost's
inner state as a structured document: what it carries, what it is trying to
accomplish (**goals**), and what it **remembers** — framed for **observability
of an agent**, not a player-inventory screen. The data source is the ghost's
MCP state, surfaced via the ghost house API. This is the most speculative
component — the exact data model depends on RFC-0007 ghost house
implementation. It is scoped here as a placeholder and deferred to a follow-up spec.

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

3. **Basemap or void?** At area and neighbor scale, should the hex grid float
   in a dark void, or sit over a minimal building-footprint basemap from
   MapLibre? The void is more atmospheric; the basemap aids physical
   orientation for attendees on the conference floor. This is an experience
   design decision, not an architecture decision — both are straightforward
   with deck.gl. Deferred to implementation iteration.

4. **Ghost interiority data contract.** The Ghost scale requires a read API for
   ghost inventory, **goal** state, and **memories**. This is not yet defined in
   RFC-0007. Ghost scale is in scope for this RFC as a navigation destination
   but its content is blocked on a follow-up contract with the ghost house.

5. **Pairing flow.** How does a human establish a paired ghost? Sign-up and
   pairing are mentioned in the project overview but not yet specified in an
   RFC. The intermedium needs a pairing state to gate partner/ghost scale
   access and to identify which conversation thread to subscribe to.

6. **Transition animation budget.** Are animated scale transitions in scope for
   MVP? The mechanics (discrete state changes) are defined; whether transitions
   are instant cuts or smooth morphs is an implementation choice. Suggested
   default: instant for MVP, animated in follow-up.

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
Would require building a geocoding bridge from H3 indices to scene coordinates,
and has no native H3 layer primitive. The additional flexibility is not needed
and the H3 integration cost is not justified given deck.gl's native support.
Remains a viable option if the visual aesthetic requires 3D depth effects not
achievable in deck.gl.

**kepler.gl.** Sits on top of deck.gl and provides a complete geospatial
exploration application. Too opinionated — its UI is designed for analysts, not
conference attendees. The spectator client needs composable primitives, not a
pre-built application shell. Rejected.

**Wonderland Engine.** WebXR-first. Appropriate if the experience were AR
(holding a phone up to see ghost world overlaid on real space). Not appropriate
for a phone/desktop spectator interface without a headset. Deferred — could be
revisited if an AR mode is pursued post-AIEWF.
