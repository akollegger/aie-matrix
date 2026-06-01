# RFCs — Requests for Comment

RFCs propose new features, components, or game mechanics before implementation begins. They invite discussion and iteration before code is written.

## When to Write an RFC

- Proposing a new subsystem or module (e.g., a memory module implementation, a new ghost class, a new human-facing client)
- Significant changes to existing game mechanics or APIs
- Vendor contributions that introduce new interfaces or behaviors

Small, well-understood changes can go straight to a PR with a clear description.

## Format

Create a new file: `proposals/rfc/NNNN-short-title.md`

```markdown
# RFC-NNNN: Title

**Status:** draft | under review | accepted | rejected  
**Date:** YYYY-MM-DD  
**Authors:** @handle  
**Related:** links to issues, ADRs, or other RFCs

## Summary

One paragraph: what is being proposed?

## Motivation

What problem does this solve? What use case does it enable?

## Design

How does it work? Include interfaces, data structures, or pseudocode as appropriate.

## Open Questions

What is still unresolved? What feedback are you seeking?

## Alternatives

What other approaches were considered?
```

## Index

| RFC | Title | Status |
|---|---|---|
| [RFC-0001](0001-minimal-poc.md) | Minimal Proof-of-Concept | draft |
| [RFC-0002](0002-rule-based-movement.md) | Rule-Based Movement Mechanics Using Pattern Matching | draft |
| [RFC-0003](0003-ghost-cli.md) | ghost-cli — Human-Operated Ghost CLI | draft |
| [RFC-0004](0004-h3-geospatial-coordinate-system.md) | H3 Geospatial Coordinate System | accepted |
| [RFC-0005](0005-ghost-conversation-model.md) | Ghost Conversation Model | accepted |
| [RFC-0006](0006-world-objects.md) | World Items | under review |
| [RFC-0007](0007-agent-host-architecture.md) | Agent Host Architecture | accepted |
| [RFC-0008](0008-human-spectator-client.md) | Intermedium — Human Spectator Client | draft |
| [RFC-0009](0009-map-format-pipeline.md) | Map Format Pipeline (.tmj → .map.gram → HTTP) | draft |
| [RFC-0010](0010-h3geojson-map-editor.md) | H3 GeoJSON Map Editor | draft |
| [RFC-0011](0011-ghost-personality-substructure.md) | Ghost Personality Substructure | draft |
| [RFC-0012](0012-speaker-rooms.md) | Speaker Rooms | draft |
| [RFC-0013](0013-map-management.md) | Map Management — Publish, Activate, and Archive | under review |
| [RFC-0014](0014-admin-ghost-management.md) | Admin Ghost Management Panel | draft |
| [RFC-0015](0015-rdc-duels.md) | RDC Duels | draft |
| [RFC-0016](0016-rdc-bounty-hunting.md) | RDC Bounty Hunting — claim mechanics | draft |
| [RFC-0017](0017-rdc-server-capability-gating.md) | RDC Server Capability Gating | draft |
| [RFC-0018](0018-rdc-skill-tiers-and-math-schools.md) | RDC Skill Tiers & Mathematical Schools | draft |
| [RFC-0019](0019-barnacle-protocol.md) | The Barnacle Protocol — mini-game plugin contract | draft |
| [RFC-0020](0020-platform-links.md) | Platform Links — Pocket World Navigation Protocol | draft |
| [RFC-0021](0021-world-calendar.md) | World Calendar — Temporal Dimension and Scheduled Events | accepted |
| [RFC-0022](0022-group-exam-eval-protocol.md) | Group Exam Eval Protocol — Survival-Driven Multi-Agent Evaluation | draft |
| [RFC-0023](0023-in-world-resource-ledger.md) | In-World Resource Ledger | draft |
| [RFC-0024](0024-group-formation-and-chat.md) | Group Formation and Group Chat | draft |
