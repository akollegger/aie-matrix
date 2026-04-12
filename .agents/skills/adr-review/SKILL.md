---
name: adr-review
description: Review a draft ADR for decision clarity, rationale quality, and long-term usefulness as a project record. Use before accepting an ADR or merging a proposal branch. Produces concrete suggested revisions, not just a report.
---

# ADR Review

## Overview
Use this skill to evaluate a draft ADR before it is accepted and merged. An ADR is the project's long-term memory — it will be read months later by contributors who weren't in the original conversation. The standard is higher than "technically correct": the ADR must be useful to a future reader who needs to understand what was decided and why, or who is considering superseding it.

Works for self-review by the author, maintainer review during a PR, or peer feedback from a collaborator. Produces specific, actionable suggested revisions — not a checklist of observations.

## Workflow
1. Read the ADR in `proposals/adr/`.
2. Read `proposals/adr/README.md` to confirm structural compliance.
3. Read the relevant sections of `docs/architecture.md` to check consistency.
4. Evaluate the ADR against each criterion below.
5. For each criterion that fails or is weak, draft a specific suggested revision — quote the problematic text and propose replacement text or a concrete addition.
6. Summarize findings: what is strong, what needs revision, and what is blocking vs. advisory.

## Review Criteria

### 1. One decision
Does the ADR capture exactly one decision?

ADRs that bundle multiple decisions are hard to supersede partially, hard to reference precisely, and hard to reason about when the context changes.

**Flag:** The `## Decision` section contains more than one distinct choice.  
**Flag:** The title names two things joined by "and" or "with".  
**Flag:** The consequences section describes outcomes that clearly belong to a different decision.

### 2. Decision clarity
Can a reader understand what was decided by reading only the `## Decision` section?

The decision should be a clear, affirmative statement — not a summary of the context, not a restatement of the options. A future contributor should be able to read it in ten seconds and know what the project committed to.

**Flag:** The decision is phrased as a preference or tendency ("we prefer X") rather than a commitment ("X is the ghost wire protocol").  
**Flag:** The decision section restates the context or explains the problem instead of stating the resolution.  
**Flag:** The decision is qualified with so many conditions that it is unclear what was actually settled.

### 3. Context necessity
Does the context explain *why a decision was needed*, not just what the situation is?

Context should make the decision feel motivated. A reader should understand the pressure or constraint that forced a choice, not just the background facts.

**Flag:** Context reads as a technology survey or general description with no stated forcing function.  
**Flag:** It is unclear from the context why the project could not simply defer this decision.  
**Flag:** Context is so long it buries the forcing function — consider trimming to what directly motivated the decision.

### 4. Rationale specificity
Does the rationale explain why *this option* won over the alternatives, with reasons specific to this project?

Generic rationale ("simpler", "more widely used", "better performance") is weak. A future reader considering superseding this ADR needs to know whether the project-specific conditions that drove the decision still hold.

**Flag:** Rationale uses only generic claims with no reference to this project's constraints, contributors, or architecture.  
**Flag:** Rationale restates the decision rather than defending it.  
**Flag:** Rationale addresses a different question than the one the decision answers.

### 5. Credible alternatives
Were the alternatives genuinely on the table, and does each have a project-specific rejection reason?

Alternatives are not strawmen — they are options that a reasonable contributor might have chosen. A reader considering reopening this decision needs to know what was evaluated and why it lost.

**Flag:** An alternative is included that no one would seriously propose.  
**Flag:** A significant alternative is missing — one a reviewer would ask "why not X?" about.  
**Flag:** Rejection reasons are generic ("too complex", "not mature enough") without project-specific grounding.  
**Flag:** An alternative is described dismissively rather than charitably.

### 6. Honest consequences
Does the consequences section acknowledge what becomes *harder* alongside what becomes easier?

An ADR that lists only positive consequences is incomplete and loses credibility. Every real decision has costs. Naming them honestly makes the ADR more trustworthy and helps future contributors know what to watch for.

**Flag:** Consequences section lists only benefits.  
**Flag:** A significant cost named in the alternatives section (as a reason another option was rejected) does not appear in consequences.  
**Flag:** Consequences are vague ("some things will be easier") rather than concrete ("contributors in languages without MCP SDKs must implement the protocol directly").

### 7. Reversibility
Is the cost of reversing this decision acknowledged?

ADRs exist precisely for costly-to-reverse decisions. If this decision is easy to reverse, it may not need an ADR. If it is hard to reverse, the consequences section should say so — this helps future contributors understand the weight of superseding it.

**Flag:** A costly-to-reverse decision makes no mention of reversal cost.  
**Flag:** The decision appears easy to reverse — worth asking whether an ADR is the right vehicle or whether a PR description would suffice.

### 8. Architecture consistency
Does the ADR align with `docs/architecture.md`, and does it update what it should?

If the ADR resolves an open question, it should say so. If it changes a decided component, it should reference or propose a supersession. Silent inconsistencies become landmines for future contributors.

**Flag:** ADR introduces a technology or pattern that contradicts `docs/architecture.md` without acknowledgment.  
**Flag:** ADR resolves an open question from `docs/architecture.md` but does not reference it.  
**Flag:** ADR should supersede an earlier ADR but does not say so.

### 9. ADR necessity
Is this actually an ADR-level decision?

ADRs are for decisions that are costly to reverse, define a shared interface, choose a core technology, or resolve an architecture open question. Implementation choices, coding conventions, and easily-changed configuration do not belong here.

**Flag:** The decision described could be reversed with a one-line config change or a small refactor.  
**Flag:** The decision is scoped to one package and has no consequences for any other part of the system.

## Output Format

```
## ADR Review: [ADR title]

### Summary
[2-3 sentences: overall assessment and whether it is ready to accept]

### Blocking Issues
[Issues that must be resolved before the ADR is accepted. For each: criterion, problem, suggested revision.]

### Advisory Issues
[Issues worth addressing but not blocking. Same format.]

### Strengths
[What is working well and should be preserved.]
```

For each blocking or advisory issue, include:
- **Criterion:** which of the nine criteria applies
- **Problem:** what is wrong or missing, with a quote if relevant
- **Suggestion:** specific text to add, remove, or replace
