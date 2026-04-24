## Executive summary

- **Recommendation:** **Proceed with changes** — a third party can integrate with **one HTTP registration call** plus standard A2A agent hosting; no monorepo or pnpm workspace coupling required.
- **SC-003:** Automated register/spawn/synthetic path is **minutes** on a prepared machine; formal **&lt; 4h cold contributor** claim still needs a timed human study (worksheet in `spike-b-sample-agent/README.md`).
- **Auth:** Deliberately absent locally; document as blocker for production only.

## What worked

- **FR-005:** Single path `POST /v1/catalog/register` with `{ agentId, baseUrl }` verified against live agent card fetch.
- **FR-006:** `[SESSION_START]` log line with `sessionId` + first A2A response (`spawn-ack`).
- **FR-007:** House sends IC-008-shaped `data` message; agent returns `aie-matrix.spike.agent-response.v1` in `data` part (captured in house logs and JSON response).
- **Infrastructure:** Node + two localhost HTTP services sufficient.

## What didn’t

- No measurement yet from a participant **without** prior A2A context (only engineer validation).
- No NAT / public URL / tunnel testing for vendor webhooks.

## What we learned (ADR / RFC deltas)

- **RFC-0007 agent card:** Sample card includes `mx_*` fields via cast; confirm whether RFC schema should allow extension fields as passthrough vs strict validation at catalog.
- **Catalog API:** House-specific REST is **not** A2A — RFC should keep catalog HTTP separate from A2A surfaces to avoid confusion.

## Recommendation

**Proceed with changes:** keep catalog registration as a **documented HTTP** surface for spike B; for production, align with RFC catalog service naming and auth. Run one cold-contributor timed session before AIEWF and paste timings into this file.

---

## IC-009 field matrix (Spike B sample card)

| Field | Result | Notes |
|-------|--------|--------|
| `name` | supported | `spike-b-sample-contributed` |
| `description` | supported | |
| `protocolVersion` | supported | `0.3.0` |
| `version` | supported | |
| `url` | supported | JSON-RPC endpoint |
| `capabilities.streaming` | supported | `false` for sample |
| `capabilities.pushNotifications` | supported | `false` for sample |
| `skills` | supported | single skill |
| `defaultInputModes` / `defaultOutputModes` | supported | text |
| `mx_tier` | supported (cast) | `wanderer` |
| `mx_ghost_classes` | supported (cast) | `["any"]` |
| `mx_required_tools` | supported (cast) | `[]` |
| `mx_capabilities_required` | supported (cast) | `[]` |
| `mx_memory_kind` | supported (cast) | `none` |
| `mx_llm_provider` | supported (cast) | `none` |
| `mx_profile.about` | supported (cast) | |
| `mx_authors` | supported (cast) | |
