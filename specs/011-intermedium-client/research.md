# Research: Intermedium — Human Spectator Client

**Feature**: 011-intermedium-client  
**Date**: 2026-04-26

## R-001: deck.gl H3 Integration

**Decision**: Use deck.gl ≥ 9 with `H3HexagonLayer`, `PointCloudLayer`, and `IconLayer` as the rendering stack.

**Rationale**: H3HexagonLayer accepts H3 index strings as the native `data` input (no coordinate conversion). Ghost positions arrive from Colyseus as H3 index strings and can be passed to PointCloudLayer after a single `h3.cellToLatLng()` call for centroid coordinates. Deck.gl runs without a basemap tile provider (using a standalone `OrthographicView` or a `MapView` with no tile layer), which produces the void aesthetic required by RFC-0008. The vis.gl / OpenVisualization ecosystem is browser-native, peer-reviewed for geospatial workloads, and ships TypeScript types.

**Alternatives considered**:
- Three.js / React Three Fiber: strong custom 3D aesthetics; requires a geocoding bridge from H3 to scene coordinates and has no native H3 layer primitive. Overhead not justified given deck.gl native support.
- kepler.gl: sits on top of deck.gl but provides a pre-built analysis application shell; too opinionated for a custom conference attendee interface.
- Wonderland Engine: WebXR-first; not appropriate for desktop/tablet spectator without a headset.

**Unresolved**: Viewport mode (OrthographicView vs. flat MapView without tiles) should be decided at implementation time based on whether lat/lng distortion near the conference floor is perceptible. Both are architecturally equivalent.

---

## R-002: Colyseus JS Client

**Decision**: Use `colyseus.js` (the browser client matching `@colyseus/core` 0.15.57) to subscribe to the same Colyseus room the debugger uses.

**Rationale**: The ghost position broadcast is already established via IC-008 (spec-005). The intermedium reads `ghostTiles` (H3 index string map keyed by ghost ID) and ignores the `tileCoords` backward-compat field. This is the documented intent in IC-008: "Map Overlay Client … works entirely from H3 indices." The intermedium plays the same role as the map overlay client sketched in IC-008. Version match to `@colyseus/core` 0.15.57 ensures schema compatibility.

**Alternatives considered**: None — Colyseus is the established broadcast channel for ghost positions per ADR-0004. Replacing it with A2A or WebSocket polling would be O(spectators) cost per update rather than O(1) fanout.

---

## R-003: World Map Topology (Gram Parsing)

**Decision**: Fetch `GET /maps/:mapId?format=gram` at startup and parse the `.map.gram` payload using `@relateby/pattern`.

**Rationale**: The HTTP map API is fully specified in `specs/010-tmj-to-gram/contracts/ic-002-maps-http-api.md`. The gram format is defined in `specs/010-tmj-to-gram/contracts/ic-001-map-gram-format.md`. The intermedium is already listed as a downstream consumer of `?format=gram` in IC-002. `@relateby/pattern` is referenced there as the parsing library. Map topology is static for a session — one fetch at startup is sufficient; no streaming or polling required.

**Alternatives considered**: MCP tool call for map topology — explicitly rejected in RFC-0008 ("No MCP tool is introduced for map topology; the static-artifact shape fits an HTTP fetch better than a tool call").

---

## R-004: A2A Conversation Stream (Gap)

**Decision**: MVP stubs the conversation panel. The intermedium will poll a `GET /conversation/:ghostId` route on the ghost house if that route is implemented, or render a "conversation unavailable" placeholder if not. The production contract (IC-002 of this feature) documents the expected streaming or push-notification mechanism for a future implementation.

**Rationale**: RFC-0008 §Open Question 2 acknowledges this gap: "The exact mechanism — whether via streaming task, push notification, or a dedicated read endpoint — depends on how RFC-0007's ghost house exposes conversation history to non-agent consumers." The ghost house A2A protocol (IC-002 in spec-009) is designed for agent-to-agent interaction, not browser clients. A stable non-agent consumer API does not yet exist.

**Expected production contract shape**:
- **Read history**: `GET /conversation/:ghostId/messages?since=<timestamp>` → `ConversationMessage[]`
- **Send message**: `POST /conversation/:ghostId/messages` with `{ content: string }`
- **Live updates**: Server-Sent Events at `GET /conversation/:ghostId/stream` or WebSocket upgrade

**Alternatives considered**:
- Full A2A task from browser: requires an A2A client in the browser and a ghost house route that accepts tasks from non-agent (human) senders; not yet specified.
- Colyseus for conversation: violates protocol role separation per ADR-0004.

---

## R-005: Ghost Interiority Read API (Placeholder)

**Decision**: Ghost scale is implemented as a placeholder panel for MVP. The interiority data contract is blocked on the ghost house team.

**Rationale**: RFC-0008 §Open Question 4: "The Ghost scale requires a read API for ghost inventory, quest state, and memories. This is not yet defined in RFC-0007." Ghost scale is a navigation destination and its UI shell is implemented; content is stubbed.

**Expected production contract shape**:
- `GET /ghost/:ghostId/state` → `{ inventory: InventoryItem[], activeQuest: Quest | null, memoryLog: MemoryEntry[] }`
- Or MCP tool call: `read_ghost_state({ ghostId })` → same payload

---

## R-006: Client Directory Rename (`client/` → `clients/`)

**Decision**: Shell-rename `client/` to `clients/debugger/`; add `clients/intermedium/` as a sibling. Update `pnpm-workspace.yaml` glob.

**Rationale**: RFC-0008 §Repository Structure. The rename is mechanical — no internal paths within the Phaser client reference the top-level `client/` directory name. The pnpm workspace `packages` field in `pnpm-workspace.yaml` currently includes `"client/**"` (or similar); this must be updated to `"clients/**"`.

**Verification needed**: Check exact glob in `pnpm-workspace.yaml` before renaming to confirm no other references depend on the `client/` path.

---

## R-007: Pairing State Management

**Decision**: The intermedium reads a pairing token from a session cookie or URL parameter. The pairing flow (sign-up, matching) is out of scope for this feature. Partner and Ghost scale are gated on `pairing !== null` in the view state machine.

**Rationale**: RFC-0008 §Open Question 5: "How does a human establish a paired ghost? Sign-up and pairing are mentioned in the project overview but not yet specified in an RFC." The intermedium only needs to know the `ghostId` it is paired with; it does not manage the pairing lifecycle.

**MVP mechanism**: Pairing token read from `?ghost=<ghostId>` URL parameter for local development and demo purposes. Production pairing flow is deferred.
