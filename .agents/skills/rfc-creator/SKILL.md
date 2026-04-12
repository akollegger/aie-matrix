---
name: rfc-creator
description: Create or update Requests for Comment for this repository. Use when the user wants a new feature, subsystem, module, game mechanic, API change, or vendor contribution proposal drafted in `proposals/rfc/` before implementation.
---

# RFC Creator

## Overview
Use this skill to draft repository-specific RFCs that follow `proposals/rfc/README.md` exactly. RFCs are for proposals before implementation, not for settled architectural decisions.

## Workflow
1. Read `proposals/rfc/README.md` and any relevant context from `README.md`, `docs/project-overview.md`, and `docs/architecture.md`.
2. Confirm the change belongs in an RFC:
   - new subsystem, module, or feature
   - significant behavior or API change
   - vendor contribution introducing new interfaces or behavior
3. Create or update `proposals/rfc/NNNN-short-title.md` using lowercase kebab-case for the filename.
4. Use this structure exactly:

```markdown
# RFC-NNNN: Title

**Status:** draft | under review | accepted | rejected
**Date:** YYYY-MM-DD
**Authors:** @handle
**Related:** links to issues, ADRs, or other RFCs

## Summary

## Motivation

## Design

## Open Questions

## Alternatives
```

## Writing Rules
- Keep `## Summary` to one clear paragraph.
- Put interfaces, flows, and pseudocode in `## Design` when useful.
- Use `## Open Questions` to surface unresolved choices instead of hiding them.
- Compare realistic alternatives, not strawmen.
- Keep the proposal consistent with the current architecture unless the RFC explicitly challenges it.

## Output
When creating a new RFC, write the file directly under `proposals/rfc/` and call out missing inputs or unresolved dependencies.
