# Feature Specification: Minimal PoC

**Feature Branch**: `001-minimal-poc`  
**Created**: 2026-04-12  
**Status**: Draft  
**Input**: User description: "a minimal poc as described in proposals/rfc/0001-minimal-poc.md, and taking into account the discussion earlier in this conversation about human tasks and open questions to be resolved"

## Proposal Context *(mandatory)*

- **Related Proposal**: `proposals/rfc/0001-minimal-poc.md`
- **Scope Boundary**: Deliver a runnable local proof of concept that lets a contributor start the system, open a browser, launch one or more ghosts, and observe valid movement on a small hex map with a compatibility check for ghost implementations.
- **Out of Scope**: Production deployment, real conference venue fidelity, persistent storage, identity-provider integration, LLM-backed ghosts, multi-process separation, production security, and a full cross-language SDK beyond the minimum compatibility surface needed for the PoC.

## Clarifications

### Session 2026-04-12

- Q: Should the registry model both GhostHouse provider registration and later ghost adoption by a caretaker? → A: Yes. The registry serves both provider registration and ghost adoption, while GhostHouse runs ghost instances on behalf of caretakers.
- Q: What adoption rule should the PoC enforce between caretakers and ghosts? → A: One caretaker adopts one ghost for the session, with no reassignment during the PoC.
- Q: Does the PoC need a user-facing caretaker adoption UI? → A: No. The caretaker exists as registry data, and adoption can be performed through a simple scripted or developer-facing flow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a Ghost End to End (Priority: P1)

A ghost provider can register a GhostHouse service, provision an adopted ghost
for a caretaker, and have that ghost discover the world state through the
published navigation interface and move across the map without reading internal
server code.

**Why this priority**: This is the core architectural claim of the PoC. If a
ghost cannot operate through the published interface alone, the PoC fails.

**Independent Test**: Start the local system, register a GhostHouse, adopt a
ghost for a caretaker, start the reference house package (`ghosts/random-house/`)
so it provisions and runs the reference ghost, and verify that the ghost can
determine its position, inspect neighbors, and move successfully while invalid
moves are rejected with a clear reason.

**Acceptance Scenarios**:

1. **Given** the local PoC is running and a GhostHouse is registered,
   **When** a caretaker adopts a ghost from that GhostHouse and the reference
   ghost starts, **Then** it receives the credentials it needs, joins the
   world, and begins moving using only the published ghost interface.
2. **Given** a ghost is on a valid tile, **When** it attempts to move to an
   adjacent valid tile, **Then** the move succeeds and the new position becomes
   visible through the published interface.
3. **Given** a ghost attempts an invalid move, **When** the move is submitted,
   **Then** the move is rejected and the response explains why.

---

### User Story 2 - Observe the World in a Browser (Priority: P1)

A spectator can open a browser, see the sample map, and watch ghost positions
update in real time as ghosts move.

**Why this priority**: The PoC must prove the read-only spectator path and make
the end-to-end demo visible to contributors.

**Independent Test**: Open the spectator view in a browser while one or more
ghosts are running and verify that the map loads and ghost positions update as
movement occurs.

**Acceptance Scenarios**:

1. **Given** the PoC server is running and no ghosts are active, **When** a
   spectator opens the browser view, **Then** the sample map renders with no
   write controls exposed.
2. **Given** the spectator view is open and a ghost moves, **When** movement is
   accepted by the world, **Then** the browser updates the ghost position without
   requiring a refresh.
3. **Given** two ghosts are moving independently, **When** a spectator watches
   the browser view, **Then** both ghosts are visible as separate moving actors.

---

### User Story 3 - Set Up the PoC Quickly (Priority: P2)

A new contributor can clone the repository, follow the documented setup steps,
complete the required manual preparation tasks, and get the PoC running locally
within a short session.

**Why this priority**: The PoC exists to align contributors around structure and
boundaries. If setup is unclear, it does not serve that purpose.

**Independent Test**: Follow the root-level setup instructions from a clean clone,
including the documented manual tasks, and confirm the full demo runs within
15 minutes on a prepared development machine.

**Acceptance Scenarios**:

1. **Given** a clean clone of the repository, **When** a contributor follows the
   documented setup steps, **Then** they can start the PoC server, browser view,
   reference house package (`ghosts/random-house/`) to obtain an adopted running
   ghost, and compatibility check without consulting source code.
2. **Given** the PoC depends on a human-authored sample map and configuration
   decisions, **When** a contributor reads the setup docs, **Then** those manual
   prerequisites are listed explicitly with expected outputs.
3. **Given** a caretaker has already adopted a ghost for the session,
   **When** another adoption or reassignment is attempted for that caretaker or
   ghost, **Then** the request is rejected by the PoC.
4. **Given** a contributor is running the PoC locally, **When** they need to
   create a caretaker adoption, **Then** the documented developer-facing flow is
   sufficient and no attendee-facing UI is required.

---

### User Story 4 - Validate Another Ghost Implementation (Priority: P3)

A ghost implementer using another language can run the compatibility check
against the local system and receive a clear pass or fail result.

**Why this priority**: This proves the interface is not tied to the reference
ghost implementation and supports future contributors.

**PoC scope note**: Phase 6 implements only the **minimal** check in
[contracts/tck-scenarios.md](./contracts/tck-scenarios.md) (registry adopt +
MCP `whereami`). Full “second implementation,” invalid-move matrix, and
shutdown automation are **deferred**; they remain the long-term intent of this
story, not PoC exit criteria.

**Independent Test**: Run the minimal compatibility check with the local stack
up and confirm exit `0`; optionally break MCP connectivity and confirm non-zero
exit with a labeled error.

**Acceptance Scenarios**:

1. **Given** the combined server is running, **When** the minimal compatibility
   check runs, **Then** it succeeds only if **reachability**, **registry adopt**,
   and **`whereami`** all succeed for a freshly provisioned ghost session.

### Edge Cases

- If the sample map is missing required tile metadata, the system must fail with
  a clear startup error rather than running with undefined movement behavior.
- If a ghost attempts a move the world rejects (for example invalid **`toward`**
  / no neighbor in that compass direction), the move must be rejected without
  corrupting the ghost position. **Capacity-based “full tile” enforcement is
  deferred for the PoC.**
- If multiple ghosts start at nearly the same time, each must receive unique
  identity and credentials through its GhostHouse and move independently.
- If the spectator connects before any ghosts are active, the map must still
  render successfully.
- If required manual prerequisites are incomplete, the documentation must make
  the missing step obvious before contributors start debugging code.
- If a caretaker or ghost already has an active adoption for the session, the
  registry must reject additional adoption or reassignment attempts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The PoC MUST provide a published ghost interaction surface that
  allows an adopted ghost to determine its current position, query neighboring
  tiles, inspect tile details, and request movement.
- **FR-002**: The PoC MUST provide a registry flow that supports GhostHouse
  provider registration before any ghost adoption occurs.
- **FR-003**: The PoC MUST provide a registry flow that supports a caretaker
  adopting a specific ghost from a registered GhostHouse for the duration of the
  conference session.
- **FR-004**: The PoC MUST enforce a one-caretaker-to-one-ghost adoption rule
  for the session and MUST reject reassignment during the PoC.
- **FR-005**: The PoC MUST include a reference ghost implementation that uses
  only the published ghost interaction surface to move through the world.
- **FR-006**: The PoC MUST include a reference **house package** under `ghosts/`
  (delivered as `ghosts/random-house/` for this PoC) that fulfills the GhostHouse
  role by provisioning and running the reference ghost on behalf of a caretaker,
  rather than assuming the ghost is started directly by the world backend.
- **FR-007**: The PoC MUST include a browser-based spectator experience that
  renders the sample map and updates ghost positions as accepted moves occur.
- **FR-008**: The PoC MUST load a human-authored sample hex map from repository
  assets and expose tile metadata from that map to the world engine; **movement
  policy** (what transitions are allowed) lives in a **ruleset separate from the
  map** (see RFC-0001), with a permissive PoC default unless documented otherwise.
- **FR-009**: The PoC MUST define and document the required manual map-authoring
  task, including the expected asset files and tile metadata needed by the world.
- **FR-010**: The PoC MUST define and document any pre-implementation decisions
  that contributors need in order to build the system consistently, including map
  orientation, ghost-interface transport choice, and shared contract publication.
- **FR-011**: The PoC MUST reject invalid movement attempts with a clear reason
  and preserve the ghost's last valid position.
- **FR-012**: The PoC MUST support at least two concurrently running ghosts in
  the local demo without requiring direct browser refresh or server restart.
- **FR-013**: The PoC MUST provide a compatibility check that verifies the ghost
  interaction surface against a live local system and reports pass or fail with
  actionable output.
- **FR-014**: The PoC MUST document a root-level local setup flow that a new
  contributor can complete without reading internal package source code.
- **FR-015**: The PoC MUST make boundary ownership explicit so contributors can
  tell which subsystem owns spectator updates, movement validation, provider
  registration, ghost adoption, and shared contracts.
- **FR-016**: The PoC MUST define the minimum cross-language compatibility
  surface needed for the reference TypeScript ghost, the Python stub, and the
  compatibility check to agree on the same world contract.
- **FR-017**: The PoC MUST treat the GhostHouse **provider runtime** (for
  example the `ghosts/random-house/` process) as separate from the world
  backends, which are responsible only for running the world and serving
  spectator and navigation state.
- **FR-018**: The PoC MUST represent caretakers in registry data but MAY satisfy
  ghost adoption through a scripted or developer-facing flow rather than a
  user-facing caretaker UI.
- **FR-019**: Ghost-side packages MUST live in a **flat** `ghosts/` namespace
  (no nested subtype directories under `ghosts/`). Runnable GhostHouse providers
  MUST use the `ghosts/<name>-house/` pattern; MCP client SDKs MUST use
  `ghosts/<name>-client/`; the compatibility check MUST live in `ghosts/tck/`.

### Key Entities *(include if feature involves data)*

- **GhostHouse**: A provider service that registers with the registry, makes
  ghosts available for adoption, and provisions and runs ghost processes on
  behalf of caretakers.
- **Caretaker**: The IRL attendee associated with an adopted ghost during the
  conference session.
- **Ghost**: A participant in the world that is adopted from a GhostHouse for a
  caretaker and has an identity, credentials, current tile, and observable
  movement history within the running demo.
- **Tile**: A map location with an identifier, class label (for example from
  Tiled tile `type`), optional custom properties from the map (none are
  normatively required for the PoC), runtime occupants as tracked by the world,
  and neighboring cells implied by the hex grid.
- **Sample Map Asset**: The human-authored map bundle stored in the repository,
  including geometry and tile metadata required for the PoC.
- **Movement ruleset**: Configured policy in `world-api`, **separate from map
  files**, that decides whether a proposed step between adjacent cells is
  allowed — typically over **edge patterns** `(fromClass)-[:ALLOWED]->(toClass)`
  with room for future predicates on tile or world state. The PoC MAY ship a
  permissive no-op ruleset; richer venue behavior layers on later without
  changing how maps author tile metadata.
- **Adoption Record**: The association between a caretaker, a GhostHouse, and an
  adopted ghost instance for the duration of a local run, with exclusive
  one-caretaker-to-one-ghost ownership in the PoC.
- **Ghost Session Credential**: The adoption or provisioning output that
  authorizes a ghost to use the published interaction surface for the duration
  of a local run.
- **Compatibility Check Case**: A defined validation step that proves a ghost
  implementation can perform the minimum required interactions correctly.

### Interface Contracts *(mandatory when crossing package/process/language boundaries)*

- **IC-001**: The registry contract MUST define GhostHouse provider registration,
  ghost adoption by a caretaker, and the provisioning outputs needed before a
  ghost process begins navigating the world.
- **IC-002**: The registry contract MUST define the exclusivity rule that one
  caretaker may hold only one ghost adoption and an adopted ghost may not be
  reassigned during the PoC session.
- **IC-003**: The ghost interaction contract MUST define position, neighbor
  lookup, tile inspection, movement request, and movement rejection semantics in
  a language-neutral form.
- **IC-004**: The spectator state contract MUST define the minimum world state
  needed for the browser view to render map and ghost positions accurately.
- **IC-005**: The sample map contract MUST define the required tile identifiers,
  class labels, neighbor semantics the world reads **from map assets**, and how
  optional custom properties are surfaced when present; it MUST NOT conflate map
  metadata with the **movement ruleset** (policy lives in `world-api` per
  RFC-0001). **PoC does not require `capacity` or other specific custom fields.**
- **IC-006**: The compatibility check contract MUST define the steps, pass/fail
  expectations, and minimum output for the **PoC** (see [contracts/tck-scenarios.md](./contracts/tck-scenarios.md)): a **minimal** live-stack exercise of **a house-provisioned ghost** through the published registry and MCP (**reachability → adopt → `whereami`**). Broader matrix (invalid moves, alternate houses, other languages) is **explicitly deferred** and does not block PoC closure.
- **IC-007**: The local setup contract MUST define the minimum developer-facing
  adoption flow needed to create a caretaker, adopt a ghost, and start the
  reference house package (`ghosts/random-house/`, or a documented equivalent).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contributor can start the local PoC from a clean clone and reach
  the full demo flow, including manual prerequisites, within 15 minutes on a
  prepared development machine.
- **SC-002**: The reference ghost completes at least one successful move and one
  rejected invalid move during a local run without any direct access to internal
  server code.
- **SC-003**: The spectator view renders the sample map and shows visible ghost
  position updates within 1 second of accepted movement during local testing.
- **SC-004**: The **minimal** compatibility check passes for the reference stack
  and can produce a clear failing result when registry or MCP `whereami` for a
  freshly adopted ghost breaks; full alternate-implementation coverage is not a
  PoC gate.
- **SC-005**: Repository documentation is sufficient for a new contributor to
  identify the required human tasks and unresolved production concerns without
  inferring them from code.

## Assumptions

- The PoC is a local-development exercise and may use temporary shortcuts that
  are documented as non-production decisions.
- A GhostHouse runs outside the world backend and is responsible for provisioning
  and executing adopted ghost instances.
- Each caretaker has at most one adopted ghost for the PoC session, and adopted
  ghosts are not reassigned during that session.
- The PoC does not include a user-facing caretaker adoption interface; a
  developer-facing or scripted adoption flow is sufficient.
- The sample map is intentionally abstract and small; venue-accurate geography is
  deferred.
- A human contributor will create and maintain the initial sample map in Tiled as
  part of delivering the PoC.
- The project will choose one consistent hex orientation and document it before
  any map assets or movement logic are implemented.
- The published ghost interaction contract will be exposed in a form that a
  second process and a second language can consume during local development.
- The Python contribution in the PoC is limited to the minimum behavior needed to
  prove cross-language compatibility and run the compatibility check surface.

## Documentation Impact *(mandatory)*

- Update `README.md` with setup, run, and demo verification steps.
- Update `docs/architecture.md` if PoC-specific boundary decisions or temporary
  shortcuts need to be recorded.
- Keep `proposals/rfc/0001-minimal-poc.md` aligned with the implementation-ready
  scope if planning decisions narrow or clarify the PoC.
- Document the developer-facing caretaker adoption flow anywhere the local demo
  startup sequence is described.
- Add package-level README or quickstart material for any runnable package
  introduced by this feature.
- Optionally add `ghosts/README.md` as namespace documentation for the flat
  `ghosts/` layout; it MUST NOT be used to paper over a deeper hierarchy.
