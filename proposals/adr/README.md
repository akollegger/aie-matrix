# Architecture Decision Records

ADRs capture significant technical decisions: what was decided, why, and what alternatives were considered. They are the project's long-term memory.

## When to Write an ADR

- Choosing or replacing a core technology
- Defining an interface that other components will depend on (e.g., the memory module interface)
- Making a decision that would be costly to reverse
- Resolving a significant open question from [architecture.md](../../docs/architecture.md)

## Format

Create a new file: `proposals/adr/NNNN-short-title.md`

```markdown
# ADR-NNNN: Title

**Status:** proposed | accepted | superseded by ADR-XXXX  
**Date:** YYYY-MM-DD  
**Authors:** @handle

## Context

What is the situation that requires a decision?

## Decision

What was decided?

## Rationale

Why this option over the alternatives?

## Alternatives Considered

What else was on the table, and why was it not chosen?

## Consequences

What becomes easier or harder as a result of this decision?
```

## Index

| ADR | Title | Status |
|---|---|---|
| [ADR-0001](0001-mcp-ghost-wire-protocol.md) | MCP as the Ghost Wire Protocol | proposed |
