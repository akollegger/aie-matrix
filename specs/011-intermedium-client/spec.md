# Feature Specification: Intermedium — Human Spectator Client

**Feature Branch**: `011-intermedium-client`  
**Created**: 2026-04-26  
**Status**: Draft  
**Input**: User description: "the intermedium human client as described in detail in proposals/rfc/0008-human-spectator-client.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0008](../../proposals/rfc/0008-human-spectator-client.md) — Intermedium Human Spectator Client
- **Scope Boundary**: A new React-based web client (`clients/intermedium/`) that gives conference attendees a human-facing view into the ghost world: a hex-geometry spatial display with seven discrete camera stops, smooth animated transitions, and a paired-ghost conversation panel. Includes restructuring `client/` → `clients/` and renaming the Phaser client to `clients/debugger/`.
- **Out of Scope**: Ghost agent logic, ghost house server internals, human pairing flow (sign-up and matching — a separate RFC), mobile layout (deferred post-MVP), ghost interiority data contract (blocked on ghost house team), basemap vs. void decision (deferred to implementation iteration).

## Clarifications

### Session 2026-04-26

- Q: Should UI mockups be produced and approved before implementation of UI phases begins, and in what format? → A: Yes — SVG mockup per stop layout (7 total) plus one composite stop-transition diagram, committed to the spec directory and approved by the author before any UI component implementation begins.
- Q: How should the client behave when the Colyseus connection drops? → A: Freeze ghost positions (do not clear), show a small non-blocking reconnecting banner, and silently restore live positions on reconnect.
- Q: Which keyboard shortcuts control stop navigation? → A: Zoom-in / zoom-out keys cycle through stops in sequence; `Escape` returns to the previous stop; double-click or `Enter` on a focused tile/ghost jumps directly to the next meaningful stop.
- Q: How should the display behave when zero ghosts are active? → A: Show the hex grid with a subtle ambient overlay message ("Awaiting ghost arrivals…") that disappears automatically once the first ghost position is received.
- Q: What should the client display when the world map fails to load at startup? → A: A full-screen "fail whale" — a point-cloud globe rendered via PointCloudLayer, slowly rotating and pulsing as if breathing — with a retry button. Consistent with the ghost-world aesthetic; auto-retries up to 3 times before surfacing the fail state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Fleet Overview at Global/Regional Stops (Priority: P1)

A conference attendee opens the intermedium in a browser and immediately sees the entire ghost world rendered: the board appears as an extruded hex landmark in a dark void (Global stop), and as they zoom in through Regional the board resolves in scale. At Plan stop, the board switches to flat tiles and ghost positions become visible as flat circle markers.

**Why this priority**: This is the entry experience for every attendee. If the exterior stops fail to render or the transition to Plan is broken, no other stop is reachable. It is also the purest demonstration of the multi-agent observability thesis.

**Independent Test**: Open the client with no pairing; verify the board renders at Global stop, transitions to Regional and Plan correctly, and ghost positions appear at Plan. All interior stops are inaccessible if this fails.

**Acceptance Scenarios**:

1. **Given** the intermedium is open and the backend is running, **When** a new attendee loads the page, **Then** the board renders as an extruded hex grid at Global stop within 3 seconds.
2. **Given** the attendee zooms in to Plan stop, **When** ghosts are active in the world, **Then** ghost positions appear as flat circle markers updating in real time within 1 second.
3. **Given** the attendee hovers over a tile at Plan or Room stop, **When** the tile has public metadata, **Then** a tooltip or overlay shows the tile's type.

---

### User Story 2 — Stop Navigation from Global to Situational (Priority: P1)

An attendee sees the board as an extruded landmark (Global/Regional/Neighborhood stops) and cycles in through Plan and Room. At Room they see ghost identities in a panel overlay (~20%). They continue to Situational stop (~50% overlay) to watch the 7-hex proximity interactions of the ghosts nearest their focus point.

**Why this priority**: Navigation is the core interaction mechanic. Without it, the intermedium is a static map. Stop transitions — with smooth camera and LOD changes — expose the observability hierarchy that is the project's central thesis.

**Independent Test**: Can be tested without a pairing by cycling stops and using the back control. Delivers the full observability hierarchy experience without requiring a paired ghost.

**Acceptance Scenarios**:

1. **Given** the attendee is at Plan or Room stop, **When** they double-click a tile or ghost, **Then** the view transitions to the Situational stop centred on that location with a ~50% panel overlay.
2. **Given** the attendee is at any stop below Global, **When** they activate the back control (button or `Escape`), **Then** the view returns to the previous stop with the prior focus preserved.
3. **Given** the attendee is at Situational stop with a focused ghost, **When** the ghost moves, **Then** the viewport lazily follows, keeping the ghost within the central third of the visible area.
4. **Given** the attendee presses the zoom-in key, **When** a next stop exists, **Then** the view transitions with a smooth animated camera move (zoom, pitch, and pan simultaneously).

---

### User Story 3 — Paired-Ghost Conversation at Personal Stop (Priority: P2)

A paired attendee navigates to the Personal stop. The deck.gl world gives way to a React Three Fiber scene — their ghost appears as a 3D point-cloud figure. The conversation thread fills the large panel overlay (~80%). They read the thread and send a message. A minimal status readout in the panel shows the ghost’s current tile and last move direction.

**Why this priority**: The conversation panel is the personalisation layer — it distinguishes the intermedium from a generic monitoring dashboard. It depends on the pairing flow existing (a pre-condition, not implemented here).

**Independent Test**: Requires a pre-existing pairing. Can be tested with a mock pairing token. Delivers the companion experience that distinguishes this client from the debugger.

**Acceptance Scenarios**:

1. **Given** the attendee has a paired ghost and navigates to the Personal stop, **When** the stop loads, **Then** the R3F scene renders the ghost as a 3D point-cloud figure and the full conversation thread is displayed in the panel overlay.
2. **Given** the attendee is at the Personal stop, **When** they type and submit a message, **Then** the message appears in the thread and is delivered to the ghost.
3. **Given** the attendee is at the Personal stop, **When** a new message arrives from the ghost, **Then** it appears in the thread without a page reload.
4. **Given** the attendee has no pairing, **When** they attempt to navigate to the Personal stop, **Then** the system shows a clear message explaining that a pairing is required.

---

### User Story 4 — Ghost Interiority at Personal Stop (Priority: P3)

A paired attendee at the Personal stop sees their ghost’s inner state surfaced as ambient annotation in the R3F scene: what it carries (inventory), what it is currently pursuing (active goal), and what it remembers (memories). Copy is **game-inspired** (structure borrows from game UIs) but the product is **not** a game: avoid “quest” / “quest log” tone in user-facing text.

**Why this priority**: Ghost interiority is the deepest observability level and the most speculative — its data contract depends on the ghost house team delivering a read API. It is in scope as a destination but its content is a placeholder pending that contract.

**Independent Test**: Can be stubbed with mock ghost interiority data. Delivers the “interiority view” observability level even before the ghost house API is finalised.

**Acceptance Scenarios**:

1. **Given** the attendee is at the Personal stop with a paired ghost, **When** the stop loads, **Then** the ghost’s inventory, active goal summary, and memories are visible as annotation in the R3F scene.
2. **Given** the attendee is at the Personal stop, **When** the ghost’s state changes (e.g., goal or memory updates), **Then** the annotation reflects the updated state without a page reload.
3. **Given** the attendee is at the Personal stop, **When** they activate the back control, **Then** the view transitions back to the Situational stop.

---

### Edge Cases

- When the Colyseus connection drops: ghost positions freeze at last-known locations; a small non-blocking “Reconnecting…” banner appears; positions resume automatically on reconnect (FR-021).
- What happens if a paired ghost goes offline or is despawned?
- What happens if the A2A conversation subscription fails or returns no history?
- What happens when the attendee navigates to the Personal stop without a pairing?
- When the world map fails to load: auto-retry 3× with 2-second backoff, then display the “fail whale” — a point-cloud globe slowly rotating and pulsing — with a manual retry button (FR-023).
- At the Situational stop, if the focused ghost’s `h3Index` updates faster than the eye can follow, the floor cell MUST advance while the point-cloud remains visually anchored (FR-025).
- When zero ghosts are active: hex grid renders normally with a subtle “Awaiting ghost arrivals…” overlay; overlay clears automatically on first ghost arrival (FR-022).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client MUST render the ghost world as a hex grid at all geospatial stops (Global through Situational), with camera zoom matched to the active stop. At exterior stops (Global, Regional, Neighborhood) the board MUST be rendered as an extruded `H3HexagonLayer`. At interior stops (Plan through Situational) the board MUST be rendered as flat filled tiles.
- **FR-002**: The client MUST represent ghost positions according to the active stop: invisible at exterior stops (Global, Regional, Neighborhood); flat circle markers at Plan and Room; volumetric point-cloud clusters at Situational. At the Personal stop the ghost MUST be rendered as a 3D point-cloud volume in the React Three Fiber scene (FR-029).
- **FR-003**: The client MUST support seven discrete camera stops: Global, Regional, and Neighborhood (exterior) and Plan, Room, Situational, and Personal (interior). The deck.gl hex world MUST fill the full viewport at all geospatial stops; panels MUST NOT use a side-by-side flex layout that shrinks the world canvas. Approximate panel overlay footprints: Global/Regional/Neighborhood/Plan — none; Room — ~20%; Situational — ~50%; Personal — ~80% (R3F scene fills the remainder).
- **FR-004**: The client MUST maintain a view state of `{ stop, focus }` where `stop` is one of the seven named stops and `focus` is null for fixed-center stops, or a tile H3 index or ghost ID for Situational and Personal.
- **FR-005**: The client MUST subscribe to live ghost positions from the Colyseus server, consuming H3 index broadcasts without coordinate conversion.
- **FR-006**: The client MUST fetch world map topology (tile types, item placements, H3 cell graph) from the HTTP map endpoint at startup and parse the `.map.gram` format.
- **FR-007**: The client MUST display a ghost identity panel at the Room stop showing each visible ghost’s name, class, and current tile type. No conversation content is shown at this stop.
- **FR-008**: The client MUST display at the Situational stop a proximity panel listing all ghosts within the 7-hex cluster around the focused tile or ghost, showing each ghost’s name, class, and current tile type. If the attendee’s paired ghost is within the cluster, the panel appends a compact view of the most recent conversation message below the ghost list.
- **FR-009**: The client MUST display the full paired-ghost conversation thread at the Personal stop, with a minimal ghost location **status** readout (tile type, last move direction) **inside the Personal panel overlay** — not in a separate “mini-map” column. The R3F scene fills the portion of the viewport not covered by the panel.
- **FR-010**: The client MUST allow the attendee to send messages to their paired ghost from the Personal stop panel.
- **FR-011**: The client MUST consume the paired ghost’s conversation thread via the ghost house conversation interface (IC-003). In MVP, this is implemented as HTTP polling (`GET /conversation/:ghostId/messages?since=<timestamp>` every 5 seconds). When IC-003 is resolved and the ghost house exposes a streaming endpoint, the polling implementation MUST be replaceable with a Server-Sent Events subscription without changes to `ConversationThread` or `PersonalPanel`.
- **FR-012**: The client MUST display ghost interiority (inventory, active goal, memories) at the Personal stop as ambient annotation within the R3F scene, using product copy that is observability-first (not RPG-quest phrasing; see US4).
- **FR-013**: Navigation to the Personal stop MUST be gated on the presence of a pairing; unmatched attendees MUST see a clear unavailability message.
- **FR-014**: Navigation between stops MUST be triggered by: zoom-in / zoom-out keyboard keys cycling through stops in sequence; double-click or `Enter` on a focused tile or ghost to jump directly to the next meaningful stop; on-screen back button or `Escape` key to return to the previous stop.
- **FR-015**: The hex grid viewport MUST lazily follow the focused ghost at the Situational stop, keeping the focus within the central third of the visible area.
- **FR-016**: At interior stops (Plan, Room, Situational) the viewport MUST respond to pan gestures.
- **FR-017**: The repository MUST be restructured so that `client/` becomes `clients/debugger/` (the existing Phaser client, unchanged) and `clients/intermedium/` contains the new React application.
- **FR-018**: Tile type icons MUST be rendered as icon sprites over tiles that have semantic content (vendor booth, session room, etc.).
- **FR-019**: The active ghost or tile MUST be visually distinguished (selection highlight outline) at the Situational stop.
- **FR-020**: Before any UI component implementation begins, mockups (PDF or SVG) MUST be produced for each of the seven stop layouts and one composite stop-transition diagram, committed to `specs/011-intermedium-client/mockups/`, and explicitly approved by the feature author. Implementation of UI phases is gated on this approval.
- **FR-021**: When the Colyseus WebSocket connection drops, the client MUST freeze ghost positions at their last-known locations (not clear them), display a small non-blocking reconnecting banner, and automatically restore live position updates when the connection is restored — without requiring a page reload.
- **FR-022**: When zero ghosts are present in the world, the client MUST display the hex grid with a subtle ambient overlay message (“Awaiting ghost arrivals…”). The overlay MUST disappear automatically once the first ghost position is received from Colyseus.
- **FR-023**: When the world map fails to load at startup, the client MUST display a full-screen error state rendered as a point-cloud globe (using PointCloudLayer) slowly rotating and pulsing with a breathing rhythm, with a manual retry button. The client MUST auto-retry the map fetch up to 3 times with 2-second backoff before surfacing this error state. The visual must be consistent with the ghost-world aesthetic (void background, point-cloud rendering).
- **FR-024**: At Room and Situational stops, the view MUST make legible **both** (a) the **world-scale** hex context (the surrounding map at a **reduced** visual prominence — e.g. fainter, inset, or background layer) and (b) the **local-scale** grid at the zoom level of that stop (browsable region or 7-hex cluster). The attendee MUST be able to relate the zoomed view to the whole-world grid.
- **FR-025** (Situational ghost behaviour): At the Situational stop, when the focused ghost’s in-world `h3Index` changes, the ghost’s point-cloud representation MUST NOT translate across the map like a sliding sprite. The cloud MUST remain visually anchored while the **floor cell under the ghost** re-targets to the new H3 index — the cell underfoot advances, the cloud does not walk across the terrain.
- **FR-026** (Exterior stops): At exterior stops (Global, Regional, Neighborhood) the board MUST be rendered as an extruded `H3HexagonLayer`. Ghost positions MUST NOT be shown. The camera MUST point at the board’s geographic center for all three exterior stops. Target H3 resolutions: Global = R0 (globe-scale wireframe, 122 cells); Regional = R4–R5 (board visible as a small landmark rectangle); Neighborhood = R15 (board fills the frame).
- **FR-027** (Camera pitch): Each stop MUST use a defined camera pitch: 0° (overhead) for Global, Regional, Plan, and Room; 45° for Neighborhood and Situational; ~80° deck.gl pitch (near-horizontal) for Personal. Pitch MUST animate as part of each stop-to-stop transition.
- **FR-028** (Animated transitions): Stop-to-stop transitions MUST animate zoom, pitch, and pan simultaneously using deck.gl `LinearInterpolator` with an easement curve. The level-of-detail flip (extruded ↔ flat board) MUST be a hard cut timed at the midpoint of the Neighborhood → Plan transition. The Personal stop transition MUST use a fade-out before unmounting the deck.gl scene and a fade-in after mounting the R3F scene.
- **FR-029** (Personal stop renderer): The Personal stop MUST be rendered using React Three Fiber per ADR-0006. The deck.gl `DeckGL` component MUST unmount when navigating to Personal and an R3F `Canvas` MUST mount in its place; the reverse MUST occur when navigating away. No geospatial coordinate system is used in the Personal scene.
- **FR-030** (Personal floor tile): At the Personal stop, a single flat H3 tile MUST be rendered beneath the ghost point-cloud as a ground reference. The tile is the ghost’s current `h3Index` rendered as a flat filled hexagon in the R3F scene; it updates when the ghost moves.

### Key Entities

- **Ghost**: An autonomous agent with a current H3 tile index, identity (name, class), and optionally an interiority state (inventory, goals, memories). Ghosts arrive as live position broadcasts and as conversation participants.
- **Tile**: An H3 cell in the world grid with a type (open floor, vendor booth, session room, etc.) and optional item placements. Tiles are loaded once at startup from the map topology endpoint.
- **ViewState**: The top-level client navigation state `{ stop, focus }`. `stop` is one of seven named stops (Global, Regional, Neighborhood, Plan, Room, Situational, Personal); `focus` is null for fixed-center stops, or a tile H3 index or ghost ID for Situational and Personal.
- **Conversation Thread**: An ordered sequence of messages between a human attendee and their paired ghost, delivered via the ghost house A2A interface.
- **Human Pairing**: An association between a human attendee and exactly one ghost, required for Personal stop access. Established by an external pairing flow (out of scope for this feature).

### Interface Contracts

- **IC-001**: Colyseus `ghostTiles` broadcast — H3 index array per ghost, consumed directly as layer inputs without coordinate conversion. Backward-compat `tileCoords` field is ignored by the intermedium.
- **IC-002**: HTTP `GET /:mapId?format=gram` — world map topology as a `.map.gram` payload per ADR-0005. Parsed at startup.
- **IC-003**: Ghost house A2A conversation stream — the mechanism (streaming task, push notification, or dedicated read endpoint) for subscribing to and sending messages in the paired conversation thread. Contract gap pending RFC-0007 ghost house team resolution.
- **IC-004**: Ghost interiority read API — the A2A or MCP endpoint for reading a ghost's inventory, active goal, and memories at the Personal stop. Not yet defined; Personal stop interiority content is a placeholder pending this contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new attendee with no background in the project can identify where ghost activity is concentrated within 30 seconds of opening the client, starting from the Global stop.
- **SC-002**: An attendee can navigate from Global stop to Personal stop in five or fewer explicit interactions.
- **SC-003**: Ghost positions on the display update within 1 second of actual position changes in the backend.
- **SC-004**: The hex world map renders and is interactive within 3 seconds of page load on a standard conference Wi-Fi connection.
- **SC-005**: A paired attendee can read their conversation thread and send a message within 3 interactions from the Personal stop.
- **SC-006**: Engineers observing the demo can identify which protocol is serving each data concern (positions, map, conversation) from the client behaviour alone (i.e., the protocol boundaries are legible, not hidden).

## Assumptions

- Pairing (sign-up and human-to-ghost matching) is handled by a separate flow not implemented in this feature; the intermedium only reads a pairing token and gates Personal stop access on its presence.
- MVP targets desktop and tablet browsers; mobile layout (pull-up drawer model) is deferred.
- Stop-to-stop transitions animate zoom, pitch, and pan simultaneously (FR-028); the LOD flip (extruded ↔ flat) and the deck.gl ↔ R3F swap are hard cuts within the transition.
- Ghost interiority (Personal stop content) is stubbed with placeholder UI pending the ghost house team defining the read API contract.
- The void aesthetic (dark background, no building-footprint basemap) is the MVP default; basemap integration via MapLibre is deferred to implementation iteration.
- `clients/intermedium/` depends on both `@deck.gl/*` and `@react-three/fiber` + `three`; no framework code is shared with `clients/debugger/`.
- The existing Phaser debugger client continues to function unchanged after the `client/` → `clients/debugger/` rename.
- UI component implementation (SceneView, PersonalScene, PanelView, stop-specific panels) is gated on author approval of the SVG mockups committed to `specs/011-intermedium-client/mockups/`.
- The intermedium consumes `ghostTiles` H3 index broadcasts from Colyseus and ignores the `tileCoords` backward-compat field.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — update client directory structure, add intermedium to the client inventory, and update the "Human spectator client" row to list React Three Fiber alongside deck.gl.
- `docs/project-overview.md` — add intermedium as the primary attendee-facing interface.
- `clients/debugger/README.md` — update to reflect rename from `client/` and clarify that it is a developer tool, not the attendee interface.
- `clients/intermedium/README.md` — new file documenting the intermedium's purpose, target audience, and how to run it locally.
- `CONTRIBUTING.md` — update any references to `client/` directory.
