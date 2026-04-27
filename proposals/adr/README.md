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
| [ADR-0002](0002-adopt-effect-ts.md) | Adopting Effect-ts for Server Orchestration and Concurrency | accepted |
| [ADR-0003](0003-conversation-server.md) | Conversation Server as a Dedicated Service | accepted |
| [ADR-0004](0004-a2a-ghost-agent-protocol.md) | A2A as the Ghost Agent Protocol | proposed |
| [ADR-0005](0005-h3-native-map-format.md) | H3-Native Map Format (.map.gram) | proposed |
| [ADR-0006](0006-personal-stop-renderer.md) | Personal-Stop Rendering Stack | proposed |
