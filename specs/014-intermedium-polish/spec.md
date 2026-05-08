# Feature Specification: Intermedium Polish — Map, Chat, and Camera Stops

**Feature Branch**: `014-intermedium-polish`  
**Created**: 2026-05-08  
**Status**: Draft  
**Input**: User description: "Intermedium client polish and feature completeness, improving the map visualization rendering and behavior, the chat interface experience, and carefully reviewing each camera stop and transition. For each stop, include a design review of aesthetics, interactions, and purpose (each stop should have a reason for a user to spend time there)"

## Proposal Context *(mandatory)*

- **Related Proposal**: [spec-011](../011-intermedium-client/spec.md) — Intermedium Human Spectator Client (predecessor feature, now implemented)
- **Scope Boundary**: Polish and feature-completeness pass on the existing Intermedium client. Covers: (1) map visualization rendering correctness and visual quality, including ghost dot rendering and the void platter layer; (2) chat interface integration at the Personal stop; (3) design review of all six currently-implemented camera stops — aesthetics, interactions, and purpose — with specific changes to address gaps; and (4) addition of the missing `neighborhood` stop to complete the originally specified seven-stop sequence.
- **Out of Scope**: New ghost agent logic; human pairing sign-up flow; mobile layout; ghost interiority data contract (remains stubbed); basemap integration via MapLibre.

## User Scenarios & Testing *(mandatory)*

Stories are grouped by camera stop. Four dimensions guide each stop's review — understanding, discoverability, meaningful interaction, navigation continuity — but only where non-trivial for that stop. Navigation continuity across the full arc is addressed first as a cross-cutting story.

---

### Cross-cutting: Stop Arc Navigation Continuity (Priority: P1)

An attendee moves through the camera stops — inward from Global to Personal, or outward via back/escape — and at each boundary the context they built at the previous stop is preserved. When they drill from Plan into Room by double-clicking a tile, the Room view opens centered on that tile. When they return with Escape, they are back at Plan, not reset to Global. Focus, ghost selection, and panel state do not reset unexpectedly.

**Why this priority**: The arc from globe to conversation is the core storytelling device. If each transition drops context, the attendee must re-orient at every stop, destroying the sense of guided descent. Context preservation is the connective tissue of the experience.

**Independent Test**: Navigate forward to Situational via tile selection and ghost double-click. Press Escape three times. Verify each back step lands at the previous stop with the prior focus intact.

**Acceptance Scenarios**:

1. **Given** the attendee double-clicks a tile at Plan, **When** Room loads, **Then** the view is centered on the selected tile's area.
2. **Given** the attendee double-clicks a ghost at Room or Situational, **When** Situational loads, **Then** the focused ghost is the one double-clicked.
3. **Given** the attendee presses `=` to cycle forward from any stop, **When** the next stop loads, **Then** the focus from the previous stop is carried forward if applicable (tile focus at Room, ghost focus at Situational).
4. **Given** the attendee presses `Escape` or `-` from any stop below Global, **When** the previous stop loads, **Then** the focus and panel state from that prior stop are restored.

**Per-stop exceptions**:
- Regional → Neighborhood is focus-free (no entity selection at exterior stops); context is the camera position only.
- Personal → Situational on Escape returns to the focused ghost, not to a blank Situational view.

---

### Global Stop — "Something is happening on Earth" (Priority: P1)

#### Understanding: the attendee can orient themselves

The attendee arrives at the Global stop and immediately understands the scale: a globe, a faintly-lit venue marker, and nothing else. The aesthetics say "observe, don't interact." The venue marker — however small — is the focus point. The user knows this is a real place.

**Independent Test**: Open the client cold. A person unfamiliar with the project should be able to name "a globe" and "a small marker for a location" within 5 seconds.

**Acceptance Scenarios**:

1. **Given** the client loads, **When** the Global stop renders, **Then** the globe wireframe is visible against the void background within 3 seconds.
2. **Given** the Global stop is active, **When** the attendee looks at the viewport, **Then** the venue location is visually distinguished from the rest of the globe surface (extruded marker or bright point).

#### Discoverability: the attendee knows how to advance

The attendee sees a visible hint indicating how to proceed. They do not need to guess keyboard shortcuts or click a hidden affordance.

**Independent Test**: Without any documentation, a first-time user should spot the navigation hint and know what key or action advances the view.

**Acceptance Scenarios**:

1. **Given** the Global stop renders, **When** no interaction has occurred yet, **Then** a navigation hint is visible (e.g., "Press `+` to zoom in").
2. **Given** the attendee performs their first interaction (pressing `+`, clicking, etc.), **When** the stop advances, **Then** the hint is no longer needed and MAY fade out.

---

### Regional Stop — "The ghost world is in San Francisco" (Priority: P1)

#### Understanding: the attendee reads geographic context

The drill-in animation plays automatically. By the time it completes, the attendee sees Moscone Center in the context of recognizable SF landmarks. The animation is cinematic — the attendee is a passenger, not a pilot.

**Independent Test**: Observe the Regional stop from arrival to drill completion. A person who knows San Francisco should be able to identify the neighborhood.

**Acceptance Scenarios**:

1. **Given** the attendee arrives at Regional, **When** the drill-in animation completes, **Then** the venue marker is centered and visually prominent.
2. **Given** the drill-in completes, **When** the attendee looks at the viewport, **Then** at least two geographic landmarks are visible as markers (e.g., Ferry Building, Caltrain) providing city-scale orientation.

#### Discoverability: the attendee knows the drill is done and what to do next

The animation has a clear end state. After the drill completes, the affordance to advance is visible — the attendee knows to press `+` to continue inward.

**Acceptance Scenarios**:

1. **Given** the drill-in animation completes, **When** the camera settles, **Then** the navigation hint or an equivalent cue is visible indicating the next action.
2. **Given** the attendee presses `+` after the drill completes, **When** the stop advances, **Then** the transition to Neighborhood is smooth (no jump or blank frame).

---

### Neighborhood Stop — "This is a conference hall" *(to be added — Priority: P2)*

#### Understanding: the attendee sees venue scale

This stop does not yet exist. When added, it bridges the cinematic globe drill-in and the flat overhead Plan view. The attendee arrives at a 45° angled view of the conference floor where the hex grid is dense enough to suggest rooms and corridors, but the whole board is still visible.

**Independent Test**: Navigate Global → Regional → Neighborhood. Verify that the board occupies the majority of the viewport at an angle that conveys spatial depth.

**Acceptance Scenarios**:

1. **Given** the attendee advances from Regional, **When** Neighborhood loads, **Then** the board fills at least 70% of the viewport height at ~45° pitch.
2. **Given** the Neighborhood stop is active, **When** the attendee looks at the viewport, **Then** the hex row structure is visible (individual tile rows distinguishable) and the board boundary is in frame.
3. **Given** the Neighborhood stop is active, **When** ghosts are present in the world, **Then** no ghost markers are displayed (exterior stop — FR-002 from spec-011).

#### Discoverability: the attendee understands this is a bridge

The stop should feel like a dramatic zoom moment, not a stopping point requiring interaction. The affordance to advance to Plan is present but the stop's primary value is the visual transition.

**Acceptance Scenarios**:

1. **Given** the Neighborhood stop renders, **When** the camera settles, **Then** the navigation hint is visible.
2. **Given** the attendee presses `+`, **When** Plan loads, **Then** the camera moves from 45° pitch to 0° overhead as part of the transition, making the LOD flip feel natural.

---

### Plan Stop — "Where is the action?" (Priority: P1)

#### Understanding: the attendee reads the map layout and ghost distribution

The overhead flat view shows the whole board. Tile types are visually differentiated — the attendee can distinguish open corridors from session rooms from vendor booths at a glance. Ghost markers are the most visually prominent element when ghosts are present.

**Independent Test**: With 5 active ghosts, stand at the Plan stop for 10 seconds. A tester should be able to name where ghost activity is concentrated (e.g., "three ghosts are in the upper-left cluster") without any additional UI.

**Acceptance Scenarios**:

1. **Given** the Plan stop is active with ghosts present, **When** the attendee looks at the viewport, **Then** ghost markers are the visually dominant element — brighter and more prominent than tile fill.
2. **Given** the Plan stop is active, **When** the attendee scans the map, **Then** at least three tile categories are visually distinguishable by color, opacity, or pattern.
3. **Given** the Plan stop is active, **When** the attendee looks at the map boundary, **Then** no void-platter wireframe artifacts appear outside the tile footprint.

#### Discoverability: the attendee understands what is interactive

The attendee can tell that tiles and ghost markers respond to interaction, and that double-clicking drills deeper. Hover state on tiles and ghosts confirms interactivity.

**Acceptance Scenarios**:

1. **Given** the attendee hovers over a tile, **When** the cursor is over an interactive tile, **Then** a visual hover state appears (highlight or tooltip).
2. **Given** the attendee hovers over a ghost marker, **When** the cursor is over the marker, **Then** the cursor changes or the marker highlights to indicate it is clickable.

#### Meaningful interaction: the attendee drills into an area or ghost

The attendee chooses where to explore next by double-clicking a tile (to enter Room focused on that area) or double-clicking a ghost marker (to enter Situational focused on that ghost).

**Acceptance Scenarios**:

1. **Given** the attendee double-clicks a tile at Plan, **When** the double-click registers, **Then** the view transitions to Room centered on that tile's area disk.
2. **Given** the attendee double-clicks a ghost marker at Plan, **When** the double-click registers, **Then** the view transitions to Situational with that ghost as the focus.

---

### Room Stop — "Who's in this area?" (Priority: P1)

#### Understanding: the attendee reads ghost identities in the focal area

The focal tile's surrounding disk is rendered at full prominence; the rest of the board dims. The ghost identity panel appears automatically — the attendee does not need to click or toggle anything to see which ghosts are nearby.

**Independent Test**: Navigate to Room by double-clicking a tile that has at least one ghost nearby. The ghost identity panel should be visible immediately with no additional interaction.

**Acceptance Scenarios**:

1. **Given** the attendee arrives at Room with the focus on a tile near at least one ghost, **When** the stop renders, **Then** the ghost identity panel is visible and lists all ghosts in the area disk.
2. **Given** the ghost identity panel is visible, **When** the attendee reads it, **Then** each entry shows the ghost's name, class, and current tile type.
3. **Given** the attendee arrives at Room, **When** no ghosts are in the focal area, **Then** the panel shows a clear "no ghosts nearby" indication rather than rendering empty.

#### Meaningful interaction: the attendee selects a ghost to follow

The attendee uses Room to pick a specific ghost they want to observe more closely, then drills into Situational by double-clicking the ghost's marker.

**Acceptance Scenarios**:

1. **Given** the attendee is at Room and a ghost is visible in the focal disk, **When** they double-click the ghost's marker, **Then** the view transitions to Situational with that ghost as the focus.
2. **Given** the attendee pans within Room, **When** the focal area shifts, **Then** the ghost identity panel updates to reflect ghosts in the new viewport area.

---

### Situational Stop — "This ghost, right now" (Priority: P1)

#### Understanding: the attendee reads the 7-hex cluster and proximity context

The focused ghost's 7-hex cluster is rendered at full prominence with a distinct selection ring. The surrounding world is heavily dimmed. The panel lists all ghosts within the cluster. If the attendee's paired ghost is among them, its most recent conversation message appears as a preview.

**Independent Test**: Navigate to Situational focused on a ghost. The 7-hex cluster should be immediately legible — visually separated from the backdrop, with the panel populated.

**Acceptance Scenarios**:

1. **Given** the attendee arrives at Situational focused on a ghost, **When** the stop renders, **Then** the 7-hex cluster is visually distinct from the dimmed world backdrop (distinct ring or fill).
2. **Given** the proximity panel renders, **When** the attendee reads it, **Then** every ghost within the cluster is listed with name, class, and tile type.
3. **Given** the attendee's paired ghost is within the cluster, **When** the panel renders, **Then** the most recent message from the paired ghost's conversation thread appears as a compact preview.

#### Discoverability: the attendee knows they can go deeper (if paired)

If the attendee has a pairing, the Situational stop surfaces a path to Personal via double-click on their paired ghost. If not paired, the Personal stop affordance is absent.

**Acceptance Scenarios**:

1. **Given** the attendee has a pairing and their ghost is in the cluster, **When** they double-click the paired ghost's marker, **Then** the view transitions to Personal.
2. **Given** the attendee has no pairing, **When** they are at the Situational stop, **Then** no affordance or hint suggests that double-clicking a ghost will open a conversation.

---

### Personal Stop — "My ghost, my companion" (Priority: P1)

#### Understanding: the attendee sees their ghost and conversation without extra steps

Arriving at the Personal stop, the attendee sees the R3F ghost figure, the full conversation thread, and the ghost's current state annotation — all without pressing any button or toggle. The panel is the primary surface; the scene fills the remaining space.

**Independent Test**: With a pairing configured, navigate to Personal. Verify the conversation thread, ghost figure, and state annotation are visible within 2 seconds of arrival, before any interaction.

**Acceptance Scenarios**:

1. **Given** the attendee arrives at Personal with a pairing, **When** the stop mounts, **Then** the conversation thread is rendered inline in the panel (not behind a toggle or button).
2. **Given** the stop mounts, **When** the attendee reads the panel, **Then** the ghost's current tile type and last move direction are visible as state annotation.
3. **Given** the attendee has no pairing and navigates toward Personal, **When** the stop would mount, **Then** a clear message explains a pairing is required and the stop does not render the empty scene.

#### Discoverability: the input is ready without setup

The message input field is focused automatically on mount so the attendee can type immediately without clicking first.

**Acceptance Scenarios**:

1. **Given** the Personal stop mounts, **When** the panel finishes rendering, **Then** the message input field has focus and a cursor is visible.
2. **Given** the thread has existing messages, **When** the stop mounts, **Then** the thread is scrolled to the most recent message.

#### Meaningful interaction: the attendee sends and receives messages

The attendee types a message, submits it, and watches it join the thread. Incoming messages from the ghost appear without a page reload.

**Acceptance Scenarios**:

1. **Given** the attendee types a message and presses Enter or the send button, **When** the message is submitted, **Then** it appears at the bottom of the thread and the input clears.
2. **Given** the ghost sends a message while the attendee is at Personal, **When** the message arrives, **Then** it appears in the thread within 2 seconds and the thread scrolls to show it.
3. **Given** the floating [C] chat panel is opened from a non-Personal stop, **When** it renders, **Then** it includes a note directing the attendee to Personal for the full conversation experience.

---

### Edge Cases

- When the client loads on a slow connection, each stop must show an informative loading state — no blank void while tiles or ghost positions are pending.
- When a ghost in the Situational cluster is despawned mid-view, the panel must update gracefully without crashing.
- When the chat thread has hundreds of messages, the thread scrolls to the bottom on mount and on each new message, without blocking the UI.
- When the browser is resized mid-stop, the camera viewport recalculates and the layers refit to the new dimensions without a page reload.

## Requirements *(mandatory)*

### Functional Requirements

**Map Visualization**

- **FR-031**: Ghost positions at Plan, Room, and Situational stops MUST be rendered using one marker per ghost centered on the ghost's H3 cell centroid. The misprojecting layer configuration introduced in spec-011's initial implementation is superseded; this requirement locks the corrected approach.
- **FR-032**: The void-platter layer at the Plan stop MUST be rendered only as a faint edge boundary around the map's actual H3 footprint — not extending into empty globe space. The platter boundary MUST be derived from the tile set's edge cells, not from open-ended neighbor expansion.
- **FR-033**: At the Situational stop, the selection ring highlighting the 7-hex cluster MUST be visually distinct from the dimmed world-backdrop layer (distinct stroke color and opacity that separate the cluster from the background).
- **FR-034**: The `neighborhood` stop MUST be added as an exterior stop between `regional` and `plan` in the stop sequence. Its camera target MUST be the board's geographic center at ~45° pitch with the board filling ~70% of the viewport height.

**Chat Interface**

- **FR-035**: The paired-ghost conversation thread MUST be rendered directly within the Personal stop panel without requiring any toggle or button activation. The floating [C] chat panel MAY remain as a secondary quick-access surface from non-Personal stops but MUST NOT be the primary conversation surface at Personal.
- **FR-036**: The Personal panel MUST auto-scroll to the most recent message on mount and whenever a new message is appended.
- **FR-037**: The message input MUST receive focus automatically when the Personal stop mounts.
- **FR-038**: The floating [C] chat panel MUST include a visible note when opened from a non-Personal stop, directing the attendee to the Personal stop for the full conversation experience.

**Camera Stops**

- **FR-039** (Global): The Global stop MUST display a navigation hint indicating how to advance before any interaction has occurred. The hint MAY fade after the first interaction.
- **FR-040** (Regional): The Regional drill-in animation MUST complete automatically. On completion, at least two geographic landmark markers MUST be visible alongside the venue marker to provide city-scale context.
- **FR-041** (Neighborhood): The Neighborhood stop MUST render the board at ~45° pitch at a scale where hex rows are individually distinguishable and the full board boundary is in frame. Ghost markers MUST NOT appear (exterior stop).
- **FR-042** (Plan): Tile types at the Plan stop MUST be visually differentiated across at least three semantic categories. Ghost markers MUST be the most visually prominent element when ghosts are present.
- **FR-043** (Room): The ghost identity panel MUST be visible immediately on arrival at the Room stop without any additional user action. When no ghosts are in the focal area, the panel MUST show a clear "no ghosts nearby" indication.
- **FR-044** (Situational): The proximity panel MUST list all ghosts in the 7-hex cluster with name, class, and tile type. When the attendee's paired ghost is in the cluster, the most recent conversation message MUST appear as a compact preview.
- **FR-045** (Personal): The Personal stop MUST render the ghost figure, conversation thread, and ghost state annotation (tile type, last move direction) without any additional interaction after mounting.

**Navigation and Transitions**

- **FR-046**: Each stop-to-stop transition MUST animate zoom, pitch, pan, and bearing simultaneously. The LOD flip (extruded ↔ flat) fires as a hard cut at the midpoint of the Neighborhood → Plan transition.
- **FR-047**: Focus context MUST be preserved across stop transitions: a tile selected at Plan becomes the Room focus; a ghost selected at Room or Situational becomes the Situational or Personal focus. Pressing Escape restores the previous stop's focus from history.

### Key Entities

- **CameraStop**: The seven-stop sequence `"global" | "regional" | "neighborhood" | "plan" | "room" | "situational" | "personal"`. The `neighborhood` stop is exterior (extruded board, no ghosts), inserted between `regional` and `plan`.
- **Ghost Marker**: One marker per ghost positioned at the H3 cell centroid, visible only at interior stops (Plan, Room, Situational).
- **Void Platter**: The faint wireframe at the Plan stop marking the edge boundary of the tile footprint. Must not extend into empty globe space.
- **Personal Panel**: The primary conversation surface at Personal — renders conversation thread, message input, and ghost state annotation inline.

### Interface Contracts

- **IC-005**: Adding `"neighborhood"` to `CameraStop` requires updates to the stop type definition, stop sequence array, exterior-stop predicate, camera target computation, layer set switch, and pitch map. All switch/enum call sites over `CameraStop` MUST be updated.
- **IC-006**: `PersonalPanel` MUST render the conversation thread directly (not delegate to the floating chat panel). The floating `ChatPanel` component remains independent and MUST continue to function at non-Personal stops.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-007**: With 5 active ghosts, a tester can visually confirm each ghost marker at the Plan stop falls within its correct tile boundary — no stray markers, no clustering artifacts.
- **SC-008**: An attendee navigating Global → Personal for the first time can state the purpose of each stop in one sentence, unprompted — validated informally during the demo.
- **SC-009**: The conversation thread at the Personal stop is visible and the input is focused within 2 seconds of the stop mounting, without any additional navigation.
- **SC-010**: Navigating the full seven-stop sequence (Global → Regional → Neighborhood → Plan → Room → Situational → Personal) produces no visual pop, blank frame, or crash at any transition.
- **SC-011**: The void-platter layer at Plan produces no visible wireframe artifacts outside the hex tile footprint on a 1920×1080 display.

## Assumptions

- The `ScatterplotLayer` fix for ghost rendering (replacing the misprojecting `PointCloudLayer`) is already committed in this branch; FR-031 locks the corrected approach.
- The void platter is currently computed from `voidNeighborH3s()` in `hexViewport.ts`; the fix constrains that function's output to the map's edge cells rather than expanding into the void.
- Ghost interiority at Personal remains stubbed; this spec does not change that data contract.
- The floating [C] chat panel is retained for non-Personal stops; this spec demotes it to secondary at Personal only.
- All six currently-implemented stops are functional navigation targets; this spec adds Neighborhood and polishes the existing six.

## Documentation Impact *(mandatory)*

- `clients/intermedium/README.md` — update stop count to seven (add Neighborhood), note conversation thread is integrated in the Personal panel.
- `specs/011-intermedium-client/spec.md` — add superseded-by notes to FR-002 (ghost rendering), FR-003 (stop count), and FR-009 (Personal panel chat integration).
