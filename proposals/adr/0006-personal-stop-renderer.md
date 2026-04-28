# ADR-0006: Personal-Stop Rendering Stack

**Status:** accepted  
**Date:** 2026-04-27  
**Authors:** @akollegger

## Context

The intermedium client (`clients/intermedium/`) renders the ghost world across a
seven-stop camera model (Global, Regional, Neighborhood, Plan, Room, Situational,
Personal), replacing the original five-scale model from RFC-0008.

Six of the seven stops are geospatial: they render H3-indexed tiles as
`H3HexagonLayer` surfaces and ghost positions as `PointCloudLayer` clusters in
deck.gl's `MapView`, with pitch and zoom varying per stop but the spatial model
remaining H3-anchored throughout.

The seventh stop, **Personal**, is qualitatively different. It frames a single
ghost as a subject — no hex grid, no H3 coordinates, no geospatial reference.
The aesthetic is closer to an avatar-inspection screen than to a map: a 3D ghost
point-cloud volume in a dark void, with interiority data (goals, memories,
inventory) as ambient annotation. Geospatial context is intentionally absent;
the H3 world remains accessible by navigating back to Situational or above.

RFC-0008's alternatives section already evaluated this boundary: "Three.js /
React Three Fiber … remains a viable option if the visual aesthetic requires 3D
depth effects not achievable in deck.gl." The Personal stop is exactly that use
case. This ADR resolves that deferral.

## Decision

Use **React Three Fiber (R3F)** for the Personal stop exclusively. The six
geospatial stops continue to use deck.gl. The boundary is a clean React
unmount/mount: when the camera transitions to Personal, the deck.gl `DeckGL`
component unmounts and an R3F `Canvas` mounts in its place; the reverse occurs
on any transition back to a geospatial stop.

The view-state type distinguishes the two rendering regimes:

```typescript
type GeospatialStop =
  | "global" | "regional" | "neighborhood"
  | "plan" | "room" | "situational";
type PersonalStop = "personal";
type CameraStop = GeospatialStop | PersonalStop;
```

`SceneView` renders either `<DeckGLScene>` or `<PersonalScene>` based on this
type, never both simultaneously.

## Rationale

**deck.gl's 3D is bound to its geospatial model.** `H3HexagonLayer` and
`PointCloudLayer` operate in Web Mercator space. Even with `extruded: true` and
high pitch, the camera orbits a lat/lng center, the near-plane frustum is tuned
for geographic scales, and there is no scene graph for composing a ghost figure
with lighting or inspection UI. The Personal stop requires freedom from all of
these constraints.

**R3F is the right tool for a non-geospatial 3D scene.** It gives direct access
to the Three.js scene graph, lighting, custom shaders, and camera controls
without a geographic projection. A ghost point-cloud rendered as `Points` or a
custom particle system is a first-class R3F primitive, not an adaptation of a
geospatial layer.

**A hard render boundary is cleaner than a hybrid.** Attempting to host the
Personal view inside deck.gl — for example, using `ScenegraphLayer` with a glTF
model — requires fighting the geospatial coordinate system for a view that
explicitly has no geospatial content. A clean unmount/mount keeps both renderers
in their native modes with no cross-cutting hacks.

**R3F composes with the existing React tree.** The intermedium is already React.
R3F's declarative API fits the same component model; no new state-management
pattern is introduced. The transition is a conditional render, not a framework
boundary crossing.

## Alternatives Considered

**Stay in deck.gl for all stops.** `ScenegraphLayer` can render glTF models at
geospatial coordinates and `PointCloudLayer` already serves the ghost
point-cloud aesthetic. Avoids an additional dependency. Rejected because
deck.gl's near-frustum behavior at the extreme zoom/pitch needed for a
close-up ghost view is unpredictable, and the geospatial coordinate system is
overhead with no benefit in a scene that has no geospatial content.

**Use Three.js directly without R3F.** Gives maximum control via an imperative
API. Rejected because the intermedium is a React application; R3F keeps
rendering declarative and composable with the existing component tree without
an imperative lifecycle side-channel.

**Route Personal to a separate page.** Navigating to `/personal` or opening a
full-screen modal removes the renderer concern from `SceneView`. Rejected because
Personal is a camera stop in the same navigation hierarchy — Personal →
Situational is a stop transition, not browser back — and splitting it into a
page route fractures the back-navigation model.

**Stub Personal as a document panel for MVP.** Show only the interiority data
(goals, memories, inventory) with no 3D scene until the ghost model is defined.
A valid deferral, not an architectural decision. This ADR resolves the
architecture so that when the full Personal stop is implemented the dependency
graph is already settled.

## Consequences

**Easier:**
- The Personal scene has full Three.js capabilities — scene graph, lights,
  materials, `OrbitControls`, animations — with no geospatial constraints.
- Ghost point-cloud and future ghost-model work lives in a renderer native to
  3D, not adapted from a map layer.
- Both renderers stay in their native modes; no hybrid coordinate-system hacks
  in either direction.

**Harder:**
- `clients/intermedium/` now depends on both `@deck.gl/*` and
  `@react-three/fiber` + `three`. Bundle size increases; should be evaluated at
  integration time and lazy-loaded if the Personal stop is not reached on a
  typical session.
- The unmount/mount boundary produces a frame of black between geospatial and
  Personal stops. The transition must mask this (fade-out before unmount,
  fade-in after mount).
- Any shared visual state between Personal and the geospatial scene (ghost
  colour, selection, identity) must be managed at the React/context level, not
  at the renderer level.
- `docs/architecture.md` "Human spectator client" row must be updated to reflect
  both deck.gl and R3F as the rendering stack for `clients/intermedium/`.

**Reversibility:** Medium. Replacing R3F in the Personal stop with a different
3D renderer is straightforward because the component boundary is already defined.
Folding Personal back into deck.gl entirely would require accepting the
geospatial constraints or the `ScenegraphLayer` workaround described above.
