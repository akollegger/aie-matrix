# Agent Guidelines for aie-matrix

This file is for AI agents contributing to the repository. It complements `CLAUDE.md` (loaded automatically) with agent-specific navigation guidance.

---

## How to orient yourself

Start here, in order:

1. `CLAUDE.md` — active tech stack, commands, and pointers to everything else
2. `docs/project-overview.md` — what we're building and why
3. `docs/architecture.md` — decided stack, open questions, Effect-ts orchestration model
4. The relevant **technical guide** in `docs/guides/` before writing code in that area

For decisions already made, read the relevant ADR in `proposals/adr/` before proposing changes to the stack.

---

## Documentation structure

This repository uses a **layered knowledge architecture**. Each layer answers a different question:

| Layer | Location | Answers |
|---|---|---|
| Navigation | `CLAUDE.md` | What exists, where to look |
| Process | `CONTRIBUTING.md` | How to participate, workflow, setup |
| Technical guides | `docs/guides/` | How specific technologies work *in this project* |
| Decisions | `proposals/adr/` | Why things are the way they are |
| Proposals | `proposals/rfc/` | What is being considered |
| Feature specs | `specs/<branch>/` | What a specific feature does, step by step |

**Before writing code**, identify which technical guide applies and read it. Guides document the patterns already established — following them keeps the codebase consistent and avoids introducing patterns that duplicate or conflict with existing ones.

---

## Available technical guides

| Guide | Read before… |
|---|---|
| `docs/guides/effect-ts.md` | Writing any server handler, service, or error type |

More guides will be added as patterns are established in other subsystems.

---

## Non-obvious conventions

**Effect `R` channel as a compile gate.** If you add a new service dependency (`yield* SomeService`) to an Effect but don't add its `Layer` to `ManagedRuntime.make(...)` in `server/src/index.ts`, `pnpm typecheck` will fail. This is intentional — the type system enforces wiring correctness.

**`Match.exhaustive` as a compile gate for errors.** Adding a new `Data.TaggedError` type and including it in the `HttpMappingError` union in `server/src/errors.ts` without adding a `Match.tag` branch in `errorToResponse` will fail the build. Always do both steps together.

**Colyseus internals are off-limits.** `server/colyseus/src/` (MatrixRoom, room-schema, map loader) is not modified by the Effect-ts transition. Effect wraps around Colyseus at the bridge seam (`server/world-api/src/colyseus-bridge.ts`), not inside it.

**DCO sign-off is required.** All commits need `git commit -s`. This is checked in CI.

---

## Proposing changes

- **Significant design decisions** → open an ADR in `proposals/adr/` before implementation
- **New features or components** → open an RFC in `proposals/rfc/` before implementation
- **Small, well-understood changes** → a clear PR description is enough

See `proposals/adr/README.md` and `proposals/rfc/README.md` for file formats.

---

## Build, test, type-check

```bash
pnpm install             # workspace install
pnpm dev                 # combined server + watch
pnpm typecheck           # TypeScript across all packages (primary correctness gate)
pnpm test                # package unit tests (`test:packages`; not ghost-tck — needs server)
pnpm test:e2e            # Playwright (auto-starts server)
pnpm test:tck            # ghost contract tests (start server first)
pnpm run lint
```

`pnpm typecheck` is the first thing to run after any structural change. An unsatisfied Effect `R` channel or a missing `Match.tag` branch will surface here before any test.

---

## How documentation grows

When you establish a new pattern that other contributors will need to follow, update the relevant guide in `docs/guides/` in the same PR as the code. If no guide exists yet for that area, create one. Keep guides focused on *how this project uses* the technology, not on general tutorials.

When you make an architectural decision, record it as an ADR. When you remove a guide because the technology was replaced, remove it — stale guides cause more harm than no guide.

## Recent Changes
- 010-tmj-to-gram: Added TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@effect/cli`, `@effect/platform-node`, `h3-js`, `@relateby/pattern`, `fast-xml-parser`, `zod` 3, `ulid` (node IDs), `pixelmatch` (Layer 3 test only), `pngjs` (Layer 3 test only)
- 010-tmj-to-gram: Added [if applicable, e.g., PostgreSQL, CoreData, files or N/A]
- 007-world-objects: Added TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3, `h3-js` (existing), `fast-xml-parser` (existing — tileset parsing)

## Active Technologies
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@effect/cli`, `@effect/platform-node`, `h3-js`, `@relateby/pattern`, `fast-xml-parser`, `zod` 3, `ulid` (node IDs), `pixelmatch` (Layer 3 test only), `pngjs` (Layer 3 test only) (010-tmj-to-gram)
- On-disk `.map.gram` and `.tmj` files under `maps/`; in-memory `Map<mapId, MapIndexEntry>` in `MapService` (010-tmj-to-gram)
