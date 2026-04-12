---
name: adr-creator
description: Create or update Architecture Decision Records for this repository. Use when the user wants an ADR drafted, revised, or reviewed in `proposals/adr/`, especially for core technology choices, shared interfaces, costly-to-reverse decisions, or to resolve an open question from `docs/architecture.md`.
---

# ADR Creator

## Overview
Use this skill to create repository-specific ADRs that follow `proposals/adr/README.md` exactly. Keep the document concise, decision-oriented, and grounded in the current architecture.

## Workflow
1. Read `proposals/adr/README.md` and the relevant section of `docs/architecture.md`.
2. Confirm the change belongs in an ADR:
   - core technology choice or replacement
   - shared interface definition
   - expensive-to-reverse decision
   - resolution of an architecture open question
3. Determine the ADR filename: `NNNN-short-title` in lowercase kebab-case (e.g. `0001-world-graph-backend`).
4. Create a branch named `proposal/NNNN-short-title` matching the ADR filename exactly before writing any files. Do not proceed without switching to this branch.
5. Create or update `proposals/adr/NNNN-short-title.md` on that branch.
6. Use this structure exactly:

```markdown
# ADR-NNNN: Title

**Status:** proposed | accepted | superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Authors:** @handle

## Context

## Decision

## Rationale

## Alternatives Considered

## Consequences
```

## Writing Rules
- State one decision clearly in `## Decision`.
- Explain why this option won in `## Rationale`, not in scattered paragraphs.
- Include credible alternatives, even if rejected quickly.
- Keep consequences concrete: implementation impact, reversibility, operational cost, or coupling.
- Do not invent settled facts; align with `README.md`, `docs/project-overview.md`, and `docs/architecture.md`.

## Output
When creating a new ADR:
1. Confirm the active branch is `proposal/NNNN-short-title` before writing files.
2. Write the ADR file under `proposals/adr/`.
3. Update the index table in `proposals/adr/README.md`.
4. Mention any assumptions that still need maintainer confirmation.
5. Remind the author to run `/adr-review` before opening the proposal for comment.
