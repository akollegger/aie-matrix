# IC-009: RFC-0007 Agent Card Field Matrix (Spike B Validation)

**Status**: Draft  
**Source of truth**: [`proposals/rfc/0007-ghost-house-architecture.md`](../../../proposals/rfc/0007-ghost-house-architecture.md) — Agent Card Schema + `mx_*` table  
**Spec reference**: `spec.md` IC-001

## Purpose

During Spike B, the contributor fills this matrix in the **Spike B report** (not necessarily in this file). This contract defines the **columns** and pass criteria.

## Standard A2A card fields (exemplar — extend per SDK)

| Field | Spike result (`supported` / `workaround` / `missing` / `n/a`) | Notes |
|--------|---------------------------------------------------------------|--------|
| `name` | | |
| `description` | | |
| `protocolVersion` | | |
| `version` | | |
| `url` | | |
| `capabilities.streaming` | | |
| `capabilities.pushNotifications` | | |
| `skills` | | |
| `defaultInputModes` | | |
| `defaultOutputModes` | | |

## RFC-0007 `mx_*` extensions

| Field | Spike result | Notes |
|--------|--------------|--------|
| `mx_tier` | | |
| `mx_ghost_classes` | | |
| `mx_required_tools` | | |
| `mx_capabilities_required` | | |
| `mx_memory_kind` | | |
| `mx_llm_provider` | | |
| `mx_profile.about` | | |
| `mx_authors` | | |

## Pass criteria

- Every row has a spike result label and one sentence of implication for RFC-0007 (even if implication is “unchanged”).
- Any `missing` on a field the skeleton house relies on for registration or spawn MUST appear in the report **Recommendation** section.
