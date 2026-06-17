# Feature Specification: Session Leaderboards

**Feature Branch**: `026-session-leaderboards`  
**Created**: 2026-06-06  
**Status**: Draft  
**Input**: User description: "a leaderboard mechanism for spectators as described in @proposals/rfc/0025-session-leaderboards.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: [RFC-0025](../../proposals/rfc/0025-session-leaderboards.md)
- **Scope Boundary**: Spectator-facing ranked views of agent behavior computed from the world ledger; map-declared leaderboard queries; final frozen snapshots on game-end; Intermedium overlay panel; map editor definition display.
- **Out of Scope**: Agent-visible standings (ghosts do not consult leaderboards); composite/weighted scoring by the engine; real-time Colyseus broadcast of rankings; leaderboard authoring in the map editor (MVP is read-only display); full IAM model beyond role-based access on `finalize-leaderboards`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Spectator views live rankings (Priority: P1)

A human spectator watching a live session wants to see which ghosts are performing best. They open the Intermedium overlay and see a leaderboard panel that shows current rankings updated automatically while the session runs.

**Why this priority**: Core value proposition — without live visible rankings there is no leaderboard feature.

**Independent Test**: Can be fully tested by loading a map with one leaderboard declared, running two ghosts that earn different scores, and confirming the panel shows them in the correct ranked order and refreshes as scores change.

**Acceptance Scenarios**:

1. **Given** a running session with a map that declares one or more leaderboards, **When** a spectator views the Intermedium overlay, **Then** a leaderboard panel is visible showing each declared leaderboard by name.
2. **Given** two ghosts with different scores on the same leaderboard, **When** the panel refreshes, **Then** the higher-scoring ghost appears above the lower-scoring one.
3. **Given** a leaderboard that has just been updated, **When** a spectator is watching, **Then** the new rankings appear within the configured refresh interval without the spectator taking any action.

---

### User Story 2 — Spectator sees final frozen rankings after session ends (Priority: P2)

When the session clock runs out and the game-end signal fires, the leaderboard should freeze at its final state and display a "Session Complete" indicator so spectators know the rankings are authoritative and permanent.

**Why this priority**: Defines the moment that matters most — who won. The frozen snapshot is what is shared and remembered.

**Independent Test**: Can be fully tested by firing the `finalize-leaderboards` command and confirming the panel transitions to a frozen "Session Complete" state that does not change on subsequent refreshes.

**Acceptance Scenarios**:

1. **Given** a running session, **When** the game-end command fires, **Then** all declared leaderboards compute their final rankings and those rankings do not change afterward.
2. **Given** finalized leaderboards, **When** a spectator views the panel, **Then** a clear "Session Complete" indicator is shown alongside the frozen rankings.
3. **Given** finalized leaderboards, **When** additional ledger entries are written (e.g. late transactions), **Then** the displayed rankings remain unchanged.

---

### User Story 3 — Map author declares which leaderboards exist (Priority: P3)

A map author wants to decide which competitive dimensions matter for their map. They declare leaderboards in the map file — specifying what to count, for which actors, and with what aggregation — and those become the only leaderboards shown during the session.

**Why this priority**: Enables the content/mechanism separation that is central to the RFC design — wrong leaderboards would misrepresent the session's competitive intent.

**Independent Test**: Can be fully tested by loading two maps — one with leaderboard declarations and one without — and confirming the first shows the declared leaderboards while the second shows none.

**Acceptance Scenarios**:

1. **Given** a map with a `[leaderboards:Leaderboards | ...]` block, **When** the map is loaded into a session, **Then** only the leaderboards declared in that block are available.
2. **Given** a map with no `[leaderboards:Leaderboards | ...]` block, **When** a spectator queries available leaderboards, **Then** the result is an empty list and no default leaderboards are shown.
3. **Given** a declared leaderboard with specific parameters (resource, aggregation, direction, actorKind), **When** the leaderboard is queried, **Then** the rankings reflect only movements matching those parameters.

---

### User Story 4 — Admin finalizes leaderboards manually (Priority: P4)

A session administrator or scheduler system needs to trigger the final leaderboard freeze explicitly — either via the calendar-triggered game-end event or manually as needed.

**Why this priority**: Privileged operational action that enables orderly session close-out.

**Independent Test**: Can be fully tested by calling the finalize command as scheduler/admin role, confirming finalization succeeds, then attempting the same as a non-privileged caller and confirming it is rejected.

**Acceptance Scenarios**:

1. **Given** a running session, **When** an admin or scheduler calls `finalize-leaderboards`, **Then** all leaderboards are frozen with `isFinal: true`.
2. **Given** a user without admin or scheduler role, **When** they attempt to call `finalize-leaderboards`, **Then** the call is rejected with an authorization error.
3. **Given** a calendar event with `kind: "game-end"` and `enterCommands: ["finalize-leaderboards"]`, **When** the event fires, **Then** leaderboards are automatically finalized without manual intervention.

---

### Edge Cases

- What happens when no ledger entries exist yet for a declared leaderboard? → Returns the spec (title, description, parameters) with an empty entries list; no error.
- What happens when the same leaderboard is queried after finalization? → Returns the frozen snapshot; no recomputation occurs.
- What happens when multiple actors have identical scores? → Ties are broken by earliest achievement — the actor who reached the score first ranks higher (secondary sort on timestamp of last contributing entry).
- What happens when a leaderboard is queried before a session is active? → Returns the spec with an empty entries list; no error.
- What happens when a ghost has no display name set? → Falls back to the ghost's id as the display name.
- What happens when `finalize-leaderboards` is called twice? → Second call is idempotent; already-frozen leaderboards remain frozen.
- What happens when the leaderboard aggregate query fails (e.g. Neo4j connectivity blip)? → The service returns the last cached result as-is (stale `computedAt` timestamp signals age); the failure is logged server-side; no error is surfaced to spectators.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow maps to declare one or more named leaderboards in the map file, each specifying an aggregation query over ledger entries.
- **FR-002**: The system MUST compute leaderboard rankings on demand by running aggregate queries over the session's ledger entries.
- **FR-003**: The system MUST cache computed leaderboard results on a configurable interval (default: 60 seconds, `LEADERBOARD_TTL_MS=60000`) to avoid recomputing on every request.
- **FR-004**: The system MUST expose leaderboard data via unauthenticated read-accessible tools (no login required for spectators).
- **FR-005**: The system MUST restrict the `finalize-leaderboards` command to scheduler and admin roles only.
- **FR-006**: The system MUST freeze all declared leaderboards into permanent snapshots when `finalize-leaderboards` is executed, marking them `isFinal: true`.
- **FR-007**: After finalization, leaderboard queries MUST return the frozen snapshot without recomputing from ledger data.
- **FR-008**: The system MUST return an empty entries list (not an error) when a leaderboard is queried with no matching ledger entries.
- **FR-009**: The system MUST break score ties by the timestamp of the actor's last contributing ledger entry, ranking the actor who reached the score first higher.
- **FR-010**: The system MUST fall back to the ghost's id as display name when no instance name is set.
- **FR-011**: The Intermedium overlay MUST display a leaderboard panel showing ranked entries that updates automatically while the session is live. On panel mount, the panel MUST fetch the current rankings immediately via `leaderboard { id }`; subsequent updates arrive via `world.leaderboard.updated` A2A push only (no polling loop).
- **FR-012**: The Intermedium overlay MUST transition to a "Session Complete" visual state when `isFinal: true` is received, freezing displayed rankings.
- **FR-013**: The map editor MUST display declared leaderboard definitions (title, description, query parameters) in read-only card form when a map is loaded.
- **FR-014**: A session with no `[leaderboards:Leaderboards | ...]` block MUST produce an empty leaderboard list; no default leaderboards are injected.
- **FR-015**: When a live leaderboard recompute fails (e.g. storage unavailable), the system MUST return the last successfully cached result to the caller and log the failure; no error is returned to spectators.

### Key Entities

- **Leaderboard**: A named aggregate query declared in the map; has title, description, and query parameters (resource, aggregation, direction, actorKind, optional cause).
- **LeaderboardEntry**: One row in a leaderboard result — actor identity, display name, numeric score, and the timestamp of the actor's last contributing ledger entry.
- **LeaderboardResult**: The full result of a leaderboard query — leaderboard identity and description, ordered entries, computation timestamp, and `isFinal` flag.
- **LeaderboardSnapshot**: A permanent, frozen LeaderboardResult stored in the world graph at session end.

### Interface Contracts

- **IC-001**: Shared types `LeaderboardSpec`, `LeaderboardEntry`, and `LeaderboardResult` MUST be defined in `shared/types/` and consumed by both server and client packages.
- **IC-002**: The `world.leaderboard.updated` A2A event MUST carry a `LeaderboardResult` payload and follow the existing `WorldEventKind` pattern so Intermedium can subscribe without schema changes.
- **IC-003**: The `leaderboards()` and `leaderboard { id }` MCP tools MUST be accessible without authentication; `finalize-leaderboards` MUST require scheduler or admin role.
- **IC-004**: The `.map.gram` leaderboard declaration syntax MUST follow the existing `[leaderboards:Leaderboards | ...]` block pattern consistent with `[rules:Rules | ...]` and `[schedule:Schedule | ...]`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A spectator can open the Intermedium overlay and see ranked leaderboard results within 60 seconds of the most recent qualifying ledger activity (default `LEADERBOARD_TTL_MS=60000`, matching the calendar tick interval).
- **SC-002**: After the game-end signal fires, the leaderboard panel transitions to "Session Complete" state and rankings do not change for the remainder of the session.
- **SC-003**: A map with no leaderboard declarations produces zero leaderboard entries visible to spectators — no injected defaults appear.
- **SC-004**: All leaderboard read operations succeed without authentication for any spectator, while `finalize-leaderboards` is rejected for non-privileged callers 100% of the time.
- **SC-005**: The end-to-end demo scenario in RFC-0025 (load map → observe entries → finalize → confirm frozen → attempt unauthorized access → confirm empty for map without declarations) can be completed in under 15 minutes by a contributor unfamiliar with the feature.

## Assumptions

- The world ledger (RFC-0023) is operational and `(:LedgerEntry)` nodes exist in the session subgraph before leaderboards are queried.
- The world calendar (RFC-0021) is operational and can fire the `game-end` calendar event with `enterCommands: ["finalize-leaderboards"]`.
- Ghost display names are stored on `(:Ghost)` nodes in Neo4j at adoption time; fallback to ghost id is acceptable for MVP.
- The Intermedium client is already subscribed to A2A world events; no new subscription infrastructure is needed.
- The leaderboard cache TTL defaults to 60 seconds (`LEADERBOARD_TTL_MS=60000`), matching the `CALENDAR_TICK_MS` default. The environment variable pattern from `CALENDAR_TICK_MS` is reused.
- Role-based access for `scheduler` and `admin` follows the same enforcement mechanism used by the existing `announce` command.
- Full display name support (A2A card "surname" + per-adoption "first name") is a dependency of RFC-0007 and is deferred; ghost id fallback is sufficient for this feature's MVP.

## Clarifications

### Session 2026-06-06

- Q: What should the default leaderboard cache TTL be? → A: 60 seconds (`LEADERBOARD_TTL_MS=60000`), matching `CALENDAR_TICK_MS`
- Q: What should happen when a leaderboard aggregate query fails during a live recompute? → A: Return the last cached result (stale); log the failure server-side; no error surfaced to spectators
- Q: How should the Intermedium leaderboard panel load its initial data before the first A2A push? → A: Fetch `leaderboard { id }` once on panel mount, then rely on A2A push for updates (no polling loop)

## Documentation Impact *(mandatory)*

- `docs/architecture.md` — add LeaderboardService to the server/world-api component inventory and note the `world.leaderboard.updated` A2A event.
- `maps/<scene>/<scene>.map.gram` (demo map) — add a `[leaderboards:Leaderboards | ...]` block and update ghost system prompt to reference the competitive objective.
- `proposals/rfc/0025-session-leaderboards.md` — update status from "under review" to "accepted" once the spec is approved.
