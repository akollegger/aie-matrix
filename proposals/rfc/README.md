# RFCs — Requests for Comment

RFCs propose new features, components, or game mechanics before implementation begins. They invite discussion and iteration before code is written.

## When to Write an RFC

- Proposing a new subsystem or module (e.g., a memory module implementation, a new ghost class, a quest type)
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
| [RFC-0007](0007-ghost-house-architecture.md) | Ghost House Architecture | accepted |
| [RFC-0008](0008-human-spectator-client.md) | Intermedium — Human Spectator Client | draft |
| [RFC-0009](0009-map-format-pipeline.md) | Map Format Pipeline (.tmj → .map.gram → HTTP) | draft |
