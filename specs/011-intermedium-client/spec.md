# Feature Specification: Intermedium — Human Spectator Client

**Feature Branch**: `011-intermedium-client`  
**Created**: 2026-04-26  
**Status**: Draft  
**Input**: User description: "the intermedium human client as described in detail in proposals/rfc/0008-human-spectator-client.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0008](../../proposals/rfc/0008-human-spectator-client.md) — Intermedium Human Spectator Client
- **Scope Boundary**: A new React-based web client (`clients/intermedium/`) that gives conference attendees a human-facing view into the ghost world: a hex-geometry spatial display with five discrete zoom scales and a paired-ghost conversation panel. Includes restructuring `client/` → `clients/` and renaming the Phaser client to `clients/debugger/`.
- **Out of Scope**: Ghost agent logic, ghost house server internals, human pairing flow (sign-up and matching — a separate RFC), mobile layout (deferred post-MVP), animated scale transitions (deferred post-MVP), ghost interiority data contract (blocked on ghost house team), basemap vs. void decision (deferred to implementation iteration).

## Clarifications

### Session 2026-04-26

- Q: Should UI mockups be produced and approved before implementation of UI phases begins, and in what format? → A: Yes — SVG mockup per scale layout (5 total) plus one composite scale-transition diagram, committed to the spec directory and approved by the author before any UI component implementation begins.
- Q: How should the client behave when the Colyseus connection drops? → A: Freeze ghost positions (do not clear), show a small non-blocking reconnecting banner, and silently restore live positions on reconnect.
- Q: Which keyboard shortcut triggers zoom-out between scales? → A: `Escape` zooms out one scale; double-click or `Enter` on a focused tile/ghost zooms in.
- Q: How should the display behave when zero ghosts are active? → A: Show the hex grid with a subtle ambient overlay message ("Awaiting ghost arrivals…") that disappears automatically once the first ghost position is received.
- Q: What should the client display when the world map fails to load at startup? → A: A full-screen "fail whale" — a point-cloud globe rendered via PointCloudLayer, slowly rotating and pulsing as if breathing — with a retry button. Consistent with the ghost-world aesthetic; auto-retries up to 3 times before surfacing the fail state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Fleet Overview at Map Scale (Priority: P1)

A conference attendee opens the intermedium in a browser and immediately sees the entire ghost world rendered as a wireframe hex grid with point-cloud ghosts. They can tell at a glance how many ghosts are active, where activity is concentrated, and what the overall world layout looks like — without needing to know any game mechanics.

**Why this priority**: This is the entry experience for every attendee. If Map scale is broken or confusing, no other scale is reachable. It is also the purest demonstration of the multi-agent observability thesis.

**Independent Test**: Open the client with no pairing; verify the hex grid renders with ghost positions visible and updating in real time. All other scales are inaccessible if this fails.

**Acceptance Scenarios**:

1. **Given** the intermedium is open and the backend is running, **When** a new attendee loads the page, **Then** the full hex world renders as a wireframe grid with ghost positions displayed as point clusters within 3 seconds.
2. **Given** ghosts are moving in the world, **When** the attendee watches the Map scale view, **Then** ghost positions visibly update without a page reload, reflecting movement within 1 second.
3. **Given** the attendee hovers over a tile at Map scale, **When** the tile has public metadata, **Then** a tooltip or overlay shows the tile's type.

---

### User Story 2 — Drill-Down Navigation from Map to Neighbor Scale (Priority: P1)

An attendee sees interesting activity in a region of the world. They double-click a tile cluster to zoom into Area scale (**~80:20** panel **overlay** on a **full-bleed** world), see ghost identities in that area, and continue drilling to Neighbor scale (**~50:50 overlay**) to watch the 7-hex proximity interactions of the ghosts nearest their focus point.

**Why this priority**: Navigation is the core interaction mechanic. Without it, the intermedium is a static map. Scale transitions expose the observability hierarchy that is the project's central thesis.

**Independent Test**: Can be tested without a pairing by double-clicking tiles and using the back control. Delivers the full observability hierarchy experience.

**Acceptance Scenarios**:

1. **Given** the attendee is at Map scale, **When** they double-click a tile or ghost cluster, **Then** the view transitions to Area scale centred on that location with ghost identity information visible in the **panel overlay** (FR-003).
2. **Given** the attendee is at Area scale, **When** they double-click a ghost, **Then** the view transitions to Neighbor scale showing the 7-hex proximity cluster and a **~50:50** scene:panel **overlay** footprint.
3. **Given** the attendee is at any scale below Map, **When** they activate the back control (button or keyboard shortcut), **Then** the view returns to the previous scale with the prior focus preserved.
4. **Given** the attendee is at Neighbor scale with a focused ghost, **When** the ghost moves, **Then** the viewport lazily follows, keeping the ghost within the central third of the visible area.

---

### User Story 3 — Paired-Ghost Conversation at Partner Scale (Priority: P2)

An attendee who has been paired with a ghost (via a separate pairing flow outside this feature) navigates to Partner scale. They read the conversation thread with their ghost and send it a message. The ghost's location is shown as a minimal ambient status widget rather than a full map.

**Why this priority**: The conversation panel is the personalisation layer — it distinguishes the intermedium from a generic monitoring dashboard. It depends on the pairing flow existing (a pre-condition, not implemented here).

**Independent Test**: Requires a pre-existing pairing. Can be tested with a mock pairing token. Delivers the companion experience that distinguishes this client from the debugger.

**Acceptance Scenarios**:

1. **Given** the attendee has a paired ghost and is at Neighbor or Partner scale, **When** they navigate to Partner scale, **Then** the full conversation thread with their ghost is displayed in the panel (80% of the display).
2. **Given** the attendee is at Partner scale, **When** they type and submit a message, **Then** the message appears in the thread and is delivered to the ghost.
3. **Given** the attendee is at Partner scale, **When** a new message arrives from the ghost, **Then** it appears in the thread without a page reload.
4. **Given** the attendee has no pairing, **When** they attempt to navigate to Partner or Ghost scale, **Then** the system shows a clear message explaining that a pairing is required and Partner/Ghost scale is unavailable.

---

### User Story 4 — Ghost Interiority at Ghost Scale (Priority: P3)

A paired attendee navigates to Ghost scale and views their ghost's inner state: what it carries (inventory), what it is currently pursuing (active goal), and what it remembers (memories). There is no map view and no conversation input at this scale — it is a read-only window into the ghost's mind. Copy is **game-inspired** (structure borrows from game UIs) but the product is **not** a game: avoid "quest" / "quest log" tone in user-facing text.

**Why this priority**: Ghost scale is the deepest observability level and the most speculative — its data contract depends on the ghost house team delivering a read API. It is in scope as a navigation destination but its content is a placeholder pending that contract.

**Independent Test**: Can be stubbed with mock ghost interiority data. Delivers the "interiority view" observability level even before the ghost house API is finalised.

**Acceptance Scenarios**:

1. **Given** the attendee is at Partner scale with a paired ghost, **When** they navigate to Ghost scale, **Then** the display shows the ghost's inventory, active goal summary, and memories as a structured document.
2. **Given** the attendee is at Ghost scale, **When** the ghost's state changes (e.g., goal or memory updates), **Then** the display reflects the updated state without a page reload.
3. **Given** the attendee is at Ghost scale, **When** they activate the back control, **Then** the view returns to Partner scale.

---

### Edge Cases

- When the Colyseus connection drops: ghost positions freeze at last-known locations; a small non-blocking "Reconnecting…" banner appears; positions resume automatically on reconnect (FR-021).
- What happens if a paired ghost goes offline or is despawned?
- What happens if the A2A conversation subscription fails or returns no history?
- What happens when the attendee navigates to Partner or Ghost scale without a pairing?
- When the world map fails to load: auto-retry 3× with 2-second backoff, then display the "fail whale" — a point-cloud globe slowly rotating and pulsing — with a manual retry button (FR-023).
- At **Partner** scale, if the paired ghost’s `h3Index` updates faster than the eye can follow, the **underfoot** cell and status text MUST stay consistent; the **fixed** 3D point cloud must not imply the ghost is “off-map” (FR-025).
- When zero ghosts are active: hex grid renders normally with a subtle "Awaiting ghost arrivals…" overlay; overlay clears automatically on first ghost arrival (FR-022).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client MUST render the ghost world as a wireframe hex grid at Map, Area, Neighbor, and **Partner** scales, with **camera zoom and H3 density matched to the active scale** (farthest at Map, tightest at Partner; Partner frames **one** cell — FR-025).
- **FR-002**: The client MUST represent ghost positions as point-cloud clusters. At **Map through Neighbor** scales, clusters are positioned at H3 **cell centroids** (2D + depth cue). At **Partner** scale the paired ghost MUST be a **3D point-cloud volume** (volumetric cluster, not a flat layer-only dot), with behaviour per **FR-025**.
- **FR-003**: The client MUST support five discrete navigation scales: Map, Area, Neighbor, Partner, and Ghost, each with a defined **effective** scene:panel ratio (100:0, 80:20, 50:50, 20:80, 0:100) describing how much of the view is used by panels **as overlays** — the deck.gl **hex world MUST always fill the full viewport** at Map, Area, Neighbor, and Partner; panels MUST NOT use a side-by-side flex layout that shrinks the world canvas. At Ghost scale there is no map (0:100 = full view for the interiority document only).
- **FR-004**: The client MUST maintain a view state of `{ scale, focus }` where `focus` is null at Map scale, a region identifier at Area scale, and a ghost ID at Neighbor/Partner/Ghost scale.
- **FR-005**: The client MUST subscribe to live ghost positions from the Colyseus server, consuming H3 index broadcasts without coordinate conversion.
- **FR-006**: The client MUST fetch world map topology (tile types, item placements, H3 cell graph) from the HTTP map endpoint at startup and parse the `.map.gram` format.
- **FR-007**: The client MUST display a ghost identity panel at Area scale showing each visible ghost's name, class, and current tile type. No conversation content is shown at this scale.
- **FR-008**: The client MUST display at Neighbor scale a proximity panel listing all ghosts within the 7-hex cluster around the focused ghost, showing each ghost's name, class, and current tile type. If the attendee's paired ghost is within the cluster, the panel appends a compact view of the most recent conversation message below the ghost list.
- **FR-009**: The client MUST display the full paired-ghost conversation thread at Partner scale, with a minimal ghost location **status** widget **inside the Partner panel overlay** (not in a separate narrow "mini-map" column; the world remains full-bleed under overlays). The status readout MUST reflect the **current** H3 cell under the ghost (it **changes** when the ghost moves; the **3D point cloud** in the scene is governed by **FR-025**).
- **FR-010**: The client MUST allow the attendee to send messages to their paired ghost from the Partner scale panel.
- **FR-011**: The client MUST consume the paired ghost's conversation thread via the ghost house conversation interface (IC-003). In MVP, this is implemented as HTTP polling (`GET /conversation/:ghostId/messages?since=<timestamp>` every 5 seconds). When IC-003 is resolved and the ghost house exposes a streaming endpoint, the polling implementation MUST be replaceable with a Server-Sent Events subscription without changes to `ConversationThread` or `PartnerPanel`.
- **FR-012**: The client MUST display ghost interiority (inventory, active goal, memories) at Ghost scale as a read-only structured view, using product copy that is observability-first (not RPG-quest phrasing; see US4).
- **FR-013**: Navigation to Partner and Ghost scale MUST be gated on the presence of a pairing; unmatched attendees MUST see a clear unavailability message.
- **FR-014**: Navigation between scales MUST be triggered by explicit interaction: double-click or `Enter` on a focused tile or ghost to zoom in; on-screen back button or `Escape` key to zoom out one scale.
- **FR-015**: The hex grid viewport MUST lazily follow the focused ghost at Neighbor scale and above, keeping the focus within the central third of the visible area.
- **FR-016**: At Area scale and below, the viewport MUST respond to pan gestures.
- **FR-017**: The repository MUST be restructured so that `client/` becomes `clients/debugger/` (the existing Phaser client, unchanged) and `clients/intermedium/` contains the new React application.
- **FR-018**: Tile type icons MUST be rendered as icon sprites over tiles that have semantic content (vendor booth, session room, etc.).
- **FR-019**: The active ghost or cluster MUST be visually distinguished (selection highlight outline) at Neighbor scale and below.
- **FR-020**: Before any UI component implementation begins, SVG mockups MUST be produced for each of the five scale layouts and one composite scale-transition diagram, committed to `specs/011-intermedium-client/mockups/`, and explicitly approved by the feature author. Implementation of UI phases is gated on this approval.
- **FR-021**: When the Colyseus WebSocket connection drops, the client MUST freeze ghost positions at their last-known locations (not clear them), display a small non-blocking reconnecting banner, and automatically restore live position updates when the connection is restored — without requiring a page reload.
- **FR-022**: When zero ghosts are present in the world, the client MUST display the hex grid with a subtle ambient overlay message ("Awaiting ghost arrivals…"). The overlay MUST disappear automatically once the first ghost position is received from Colyseus.
- **FR-023**: When the world map fails to load at startup, the client MUST display a full-screen error state rendered as a point-cloud globe (using PointCloudLayer) slowly rotating and pulsing with a breathing rhythm, with a manual retry button. The client MUST auto-retry the map fetch up to 3 times with 2-second backoff before surfacing this error state. The visual must be consistent with the ghost-world aesthetic (void background, point-cloud rendering).
- **FR-024**: At **Area, Neighbor, and Partner** scales, the view MUST make legible **both** (a) the **world-scale** hex context (the surrounding map at a **reduced** visual prominence — e.g. fainter, inset, or background layer) and (b) the **local-scale** grid at the **zoom level** of that scale (browsable region, 7-hex cluster, or single cell). The attendee MUST be able to relate the zoomed view to the whole-world grid.
- **FR-025** (Partner spatial scene): At **Partner** scale, the world scene MUST frame **a single H3 cell** — the one the paired ghost **currently occupies** (or equivalent “underfoot” cell for that ghost). The camera MUST use a **high 3/4** view (tilted away from straight **overhead**; oblique / perspective may **begin** at this scale). The paired ghost MUST be shown as a **3D point cloud** in view space. When the ghost’s **in-world** `h3Index` changes, the **point-cloud MUST NOT** translate across the map like a sliding sprite; it remains **visually fixed** in the Partner view while the **floor hex / cell (grid under the ghost) updates** to the new H3 index — i.e. the **cell underfoot advances**, the cloud does not “walk” across the terrain. (Implementation may use a second `PointCloudLayer` with per-point `positions` in camera space, or equivalent; the mockup is the source of design truth.)

### Key Entities

- **Ghost**: An autonomous agent with a current H3 tile index, identity (name, class), and optionally an interiority state (inventory, goals, memories). Ghosts arrive as live position broadcasts and as conversation participants.
- **Tile**: An H3 cell in the world grid with a type (open floor, vendor booth, session room, etc.) and optional item placements. Tiles are loaded once at startup from the map topology endpoint.
- **ViewState**: The top-level client navigation state `{ scale, focus }`. Scale is one of five named modes; focus is null or an identifier (region or ghost ID).
- **Conversation Thread**: An ordered sequence of messages between a human attendee and their paired ghost, delivered via the ghost house A2A interface.
- **Human Pairing**: An association between a human attendee and exactly one ghost, required for Partner and Ghost scale access. Established by an external pairing flow (out of scope for this feature).

### Interface Contracts

- **IC-001**: Colyseus `ghostTiles` broadcast — H3 index array per ghost, consumed directly as layer inputs without coordinate conversion. Backward-compat `tileCoords` field is ignored by the intermedium.
- **IC-002**: HTTP `GET /:mapId?format=gram` — world map topology as a `.map.gram` payload per ADR-0005. Parsed at startup.
- **IC-003**: Ghost house A2A conversation stream — the mechanism (streaming task, push notification, or dedicated read endpoint) for subscribing to and sending messages in the paired conversation thread. Contract gap pending RFC-0007 ghost house team resolution.
- **IC-004**: Ghost interiority read API — the A2A or MCP endpoint for reading a ghost's inventory, active goal, and memories at Ghost scale. Not yet defined; Ghost scale content is a placeholder pending this contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new attendee with no background in the project can identify where ghost activity is concentrated on the Map scale view within 30 seconds of opening the client.
- **SC-002**: An attendee can navigate from Map scale to Partner scale in five or fewer explicit interactions.
- **SC-003**: Ghost positions on the display update within 1 second of actual position changes in the backend.
- **SC-004**: The hex world map renders and is interactive within 3 seconds of page load on a standard conference Wi-Fi connection.
- **SC-005**: A paired attendee can read their conversation thread and send a message within 3 interactions from Partner scale.
- **SC-006**: Engineers observing the demo can identify which protocol is serving each data concern (positions, map, conversation) from the client behaviour alone (i.e., the protocol boundaries are legible, not hidden).

## Assumptions

- Pairing (sign-up and human-to-ghost matching) is handled by a separate flow not implemented in this feature; the intermedium only reads a pairing token and gates scale access on its presence.
- MVP targets desktop and tablet browsers; mobile layout (pull-up drawer model) is deferred.
- Scale transitions are instant cuts for MVP; animated morphs are deferred to a follow-up iteration.
- Ghost interiority (Ghost scale content) is stubbed with placeholder UI pending the ghost house team defining the read API contract.
- The void aesthetic (dark background, no building-footprint basemap) is the MVP default; basemap integration via MapLibre is deferred to implementation iteration.
- No framework code is shared between `clients/debugger/` and `clients/intermedium/` — they have different rendering stacks.
- The existing Phaser debugger client continues to function unchanged after the `client/` → `clients/debugger/` rename.
- UI component implementation (SceneView, PanelView, scale-specific panels) is gated on author approval of the SVG mockups committed to `specs/011-intermedium-client/mockups/`.
- The intermedium consumes `ghostTiles` H3 index broadcasts from Colyseus and ignores the `tileCoords` backward-compat field.

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — update client directory structure and add intermedium to the client inventory.
- `docs/project-overview.md` — add intermedium as the primary attendee-facing interface.
- `clients/debugger/README.md` — update to reflect rename from `client/` and clarify that it is a developer tool, not the attendee interface.
- `clients/intermedium/README.md` — new file documenting the intermedium's purpose, target audience, and how to run it locally.
- `CONTRIBUTING.md` — update any references to `client/` directory.
