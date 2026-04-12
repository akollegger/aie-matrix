# Phase 0 Research: Minimal PoC

Resolves open questions from [RFC-0001](../../proposals/rfc/0001-minimal-poc.md) for implementation planning. These are **PoC planning defaults**; promote to ADR or amend RFC if implementation discovers a mismatch.

## MCP transport (`world-api`)

- **Decision**: Prefer **Streamable HTTP / SSE-style remote MCP** for local dev when supported by the chosen MCP server SDK, so ghosts hit `world-api` over HTTP similarly to future remote deployment. Fall back to **stdio** only if SDK or timeline forces it, and document the fallback in package READMEs.
- **Rationale**: RFC recommends leaning toward production topology early; HTTP-based MCP matches multi-process ghosts and non-subprocess hosts.
- **Alternatives considered**: stdio-only (simplest local glue, least like production); dual-mode (more test matrix).

## `world-api` ↔ Colyseus coupling

- **Decision**: **In-process** method calls from `world-api` into Colyseus room state for the PoC.
- **Rationale**: Fastest path to a working demo; matches RFC explicit PoC shortcut.
- **Alternatives considered**: Message bus or internal HTTP (adds latency and scaffolding before the architectural claim is proven).

## Hex orientation

- **Decision**: **Flat-top** hex layout for map math, neighbor adjacency, and Phaser rendering.
- **Rationale**: Single global convention unblocks parallel work; flat-top is widely used in hex grid references and Phaser examples, reducing contributor search cost.
- **Alternatives considered**: Pointy-top (equally valid; requires explicit doc flip if chosen later).

## Cross-language tool schema sync

- **Decision**: **`shared/types/`** remains the **canonical compile-time** source for TypeScript tools and serializers. **`python-client/`** PoC stub **MUST** treat **`tools/list` JSON Schema** from a running `world-api` as the **runtime contract check** when implementing calls; add a follow-up task for optional JSON Schema export from TS if stubs graduate beyond PoC.
- **Rationale**: Satisfies FR-016 and IC-003 without blocking on codegen tooling maturity.
- **Alternatives considered**: Codegen-only pipeline (brittle for PoC); Python hand-maintained duplicate schemas (drift risk).

## Developer-facing adoption flow

- **Decision**: **Documented script-first flow** under repo root or `server/registry/` (e.g. `pnpm run` + documented `curl` sequence, or a small Node CLI) that creates caretaker data, registers `random-house`, and performs adoption — **no** attendee-facing UI.
- **Rationale**: Matches spec clarifications and FR-018; fastest for contributors reproducing the demo.
- **Alternatives considered**: Seed-only data (less explicit about REST contract); minimal admin UI (out of scope).

## JWT / auth for PoC

- **Decision**: **Hardcoded dev secret** and documented token minting for local use only, per RFC.
- **Rationale**: Constitution allows scoped PoC shortcuts with explicit non-production labeling.
- **Alternatives considered**: Full IdP integration (explicitly out of scope).
