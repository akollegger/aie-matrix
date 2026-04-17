# Feature Specification: Rule-Based Movement

**Feature Branch**: `003-rule-based-movement`  
**Created**: 2026-04-16  
**Status**: Draft  
**Input**: User description: "rule-based movement as described in proposals/rfc/0002-rule-based-movement.md"

## Proposal Context *(mandatory)*

- **Related Proposal**: `proposals/rfc/0002-rule-based-movement.md`
- **Scope Boundary**: Replace permissive “any adjacent tile” movement with **rule-based evaluation** for **step moves between adjacent tiles** (the “go” family of movement). Movement policy is expressed as a **separate rules artifact** from map geometry. Rules use **allow-list semantics**: a step is permitted only when at least one rule explicitly allows it under the current context. Rules may reference **tile class labels** (including multiple labels per class), **step direction**, optional **constraints on the acting ghost** (such as class or role), and optional **conditions** evaluated against live world context. Operators can retain a **fully permissive rules mode** equivalent to today’s behavior, as a named configuration. When a step is denied, the acting ghost receives a **machine-readable reason identifier** and a **human-readable explanation** suitable for display or logging; ghosts do not receive a complete preview of the ruleset before acting.
- **Out of Scope**: Non-adjacent connections (for example portals, elevators, jumps), **in-place actions** (pick up, put down, toggle) as executable behaviors, **ghost inventory** and item-keyed rules, **movement cost** accounting and budgets, **atomic multi-step plans**, **ruleset hot-reload** while a session runs, and prescribing how “hinty” denial messages must be beyond the mechanical presence of reason code and description. Storage format and authoring toolchain for the rules artifact are **implementation choices** left to planning; this specification defines required **behaviors and outcomes** only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Movement Follows Authored Rules (Priority: P1)

An autonomous ghost attempts to step from its current tile to an adjacent tile. The world evaluates that attempt against the active rules and live context. Permitted steps update the ghost’s position; denied steps leave the position unchanged and return structured feedback the ghost can use to adapt.

**Why this priority**: This is the core outcome of rule-based movement: space gains meaning, and ghost behavior is constrained by policy rather than geometry alone.

**Independent Test**: Configure a small map with at least two distinguishable tile classes and a ruleset that allows some transitions and forbids others. Drive step attempts through the supported ghost interface and assert outcomes and responses without relying on internal implementation details.

**Acceptance Scenarios**:

1. **Given** a ghost on a tile whose classes and an adjacent destination tile’s classes match a rule that permits a step in the attempted direction for that ghost, **When** the ghost requests that step, **Then** the step succeeds and the ghost’s observable position matches the destination.
2. **Given** no rule permits the requested step under the current labels, ghost attributes, and evaluated conditions, **When** the ghost requests that step, **Then** the step is denied, the ghost remains on the origin tile, and the response includes a machine-readable reason identifier and a human-readable message.
3. **Given** the active configuration uses the permissive rules mode, **When** a ghost requests any valid adjacent step that the map geometry allows, **Then** the step is permitted (preserving today’s permissive baseline for operators who need it).

---

### User Story 2 - Policy Is Independent of Map Geometry (Priority: P2)

A world operator can change movement policy—what is allowed between which tile classes—without editing the map’s geometric layout. The map continues to supply adjacency and tile metadata; the rules artifact supplies who may do what, where.

**Why this priority**: Decoupling policy from geometry enables reusing maps with different events, experiments, or difficulty, which is a primary motivation for rule-based movement.

**Independent Test**: Run the same map with two different packaged rules artifacts (one restrictive, one permissive) and observe different denial patterns for the same layout.

**Acceptance Scenarios**:

1. **Given** a fixed map and two different valid rules configurations, **When** each configuration is active in turn, **Then** the same geometrically valid step may be permitted under one configuration and denied under the other.
2. **Given** a rules configuration, **When** it is prepared and activated through operator-facing configuration (exact mechanism to be decided in planning), **Then** no map edit is required solely to change which tile-class transitions are allowed.

---

### User Story 3 - Asymmetric Spaces Demonstrated (Priority: P3)

On a two-class layout, operators can demonstrate **asymmetric** reachability: some transitions exist in one direction but not the reverse, producing “rooms,” “doorways,” and blocked returns without special-case code paths.

**Why this priority**: Proves the expressive value of directed, labeled rules beyond toy permissive graphs.

**Independent Test**: Reproduce the RFC demo pattern—enter a second class from the first, move within the second class, then show that returning to the first class is denied when no rule allows it.

**Acceptance Scenarios**:

1. **Given** tile classes **A** and **B** where rules allow **A → B** and **B → B** but not **B → A**, **When** a ghost steps **A → B** and then **B → B**, **Then** both succeed if geometry supports those adjacencies.
2. **Given** the same configuration, **When** the ghost attempts **B → A**, **Then** the step is denied with structured feedback and the ghost stays on **B**.

---

### Edge Cases

- **No applicable rule**: The step is denied (allow-list semantics).
- **Multiple matching rules**: If any applicable rule permits the step under evaluated conditions, the step is permitted; evaluation details for conflicting rules are left to planning, but the observable outcome must match allow-list semantics.
- **Multi-label tile classes**: Rules may target broad labels (for example “Hallway”) while tiles carry additional labels (for example “VIP”); matching follows label overlap as described in the RFC (a rule targeting label *L* matches any tile class that includes *L* among its labels).
- **Ghost attribute constraints**: If a rule names constraints the acting ghost does not satisfy, that rule does not permit the action; another matching rule without those constraints may still permit it.
- **Conditions on rules**: When a rule includes conditions over dynamic context (for example occupancy or tile properties), denial occurs if no permitted rule matches or conditions fail—feedback must still identify denial clearly.
- **Invalid geometry**: Attempts to step to a non-adjacent or non-existent tile follow existing world validation; rule evaluation applies to geometrically valid proposed steps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The world MUST evaluate each proposed adjacent step (“go” movement) against the active rules configuration and current world context before committing a position change.
- **FR-002**: Step evaluation MUST use allow-list semantics: if no matching rule permits the step, the step MUST be denied.
- **FR-003**: Rules MUST be expressible in terms of origin tile class labels, destination tile class labels, step direction, action type corresponding to the step, optional ghost attribute constraints, and optional contextual conditions—without referencing individual tile coordinates or ghost instance identifiers.
- **FR-004**: Tile classes MAY carry multiple labels; rule matching MUST respect label overlap so general and specific policies can coexist as described in the RFC.
- **FR-005**: Operators MUST be able to select a permissive rules mode that preserves “any adjacent step allowed” behavior for compatible maps.
- **FR-006**: On denial, the acting client MUST receive a machine-readable reason identifier and a human-readable explanation; the system MUST NOT require ghosts to download or preview the full ruleset before acting.
- **FR-007**: On permit, the world MUST apply the position update consistently with existing visibility and observation paths so spectators and ghosts see the new position after a successful step.
- **FR-008**: The system MUST support authoring and packaging at least one illustrative rules configuration that demonstrates asymmetric transitions between two tile classes for acceptance testing and demos.

### Key Entities *(include if feature involves data)*

- **Rules configuration**: The packaged movement policy separate from map geometry, comprising typed relationships between tile class labels and step actions, with optional constraints and conditions.
- **Tile class labels**: Logical tags associated with map tiles for policy matching (multiple labels per class permitted).
- **World context**: The transient facts consulted during evaluation—origin and destination tile class labels, ghost attributes relevant to constraints, and any dynamic properties conditions reference.
- **Denial feedback**: The paired machine-readable reason identifier and human-readable explanation returned when a step is not permitted.

### Interface Contracts *(mandatory when crossing package/process/language boundaries)*

- **IC-001**: The published ghost-facing movement operation MUST return a clear outcome: success with updated position information, or denial with **both** a stable machine-readable reason identifier and a human-readable explanation string suitable for autonomous agents and operators.
- **IC-002**: Reason identifiers for denials MUST be enumerable and documented for ghost implementers so different clients handle denials consistently; hint content beyond the required explanation string MAY vary by world configuration without breaking the contract.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the two-class asymmetric demo configuration, at least **95%** of repeated test runs complete the scripted sequence (enter second class, move within it, fail return) with outcomes matching **User Story 3** acceptance scenarios when driven by an automated or reference client.
- **SC-002**: **100%** of denied steps in acceptance tests include both a non-empty machine-readable reason identifier and a non-empty human-readable explanation.
- **SC-003**: Switching only the active rules configuration on a fixed map changes whether at least one geometrically valid step is permitted or denied in **100%** of paired test cases designed to expose that difference.
- **SC-004**: For permitted steps measured under typical local operator setups, ghosts receive success or denial outcomes within **2 seconds** in **95%** of trials (excluding delays clearly attributable only to the requesting client or its network path).

## Assumptions

- Adjacency and map validity continue to be enforced as they are today; this feature adds policy evaluation after geometric validity.
- Operators accept that non-“go” actions and non-adjacent movement types remain future work and may reuse the same conceptual model when introduced.
- A concrete rules artifact format, loader, and validation errors will be chosen during planning; acceptance tests will target observable behaviors, not a particular file syntax.
- Ghosts may receive richer hints in denial messages in some worlds and minimal hints in others; success for this feature is defined by the presence of reason identifier and human-readable explanation, not hint strategy.

## Documentation Impact *(mandatory)*

- **World operators and contributors**: Document how to select the permissive versus authored rules modes, how to run the asymmetric two-class demo, and where reason identifiers are listed for ghost authors—once the implementation path for packaging rules is fixed (may be a short “rules overview” in existing project docs or a companion guide).
- **Ghost implementers**: Publish or extend the reason-identifier catalog alongside the movement contract so denial handling stays compatible across clients.
