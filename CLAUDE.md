# aie-matrix

A hex-tile virtual world running alongside the AI Engineer World's Fair, where autonomous agents explore and compete as digital twins of IRL attendees.

## Active Technologies
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@effect/cli`, `@effect/platform-node`, `ink` (v5+), `react` (v18) (004-ghost-cli)
- None (stateless CLI; reads `.env` via `@aie-matrix/root-env`) (004-ghost-cli)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `h3-js` (new, all affected packages), `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3 (005-h3-coordinate-system)
- Neo4j (world graph — cell identity property changes to `h3Index`); in-memory Colyseus schema (005-h3-coordinate-system)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3, `h3-js` (existing), `ulid` (new — message IDs) (006-ghost-conversation)
- JSONL on disk (`{ghost_id}.jsonl` per thread); in-memory ghost state in `ConversationService` (006-ghost-conversation)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@a2a-js/sdk` per ADR-0004 / RFC-0007; minimal additional npm deps only where the SDK does not cover HTTP serving (spike-local choice — document in `research.md` if changed) (008-a2a-ghost-house-spike)
- TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@a2a-js/sdk` 0.3.13+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3, `ulid` (event IDs), `@aie-matrix/root-env` (shared env loading) (009-ghost-house-a2a)
- File-backed JSON (`catalog.json`) for agent registration; in-memory `Map` for active agent sessions (009-ghost-house-a2a)

TypeScript 5.7 / Node.js 24, pnpm 10 workspace monorepo. Key packages: `effect` v3+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3.

## Commands

```bash
pnpm install          # install all workspace deps
pnpm dev              # run combined server in watch mode
pnpm test             # unit / TCK tests
pnpm test:e2e         # Playwright end-to-end
pnpm test:tck         # ghost contract tests (server must be running)
pnpm typecheck        # TypeScript across all packages
pnpm run lint
```

## Documentation

### Project context
- `docs/project-overview.md` — product vision, ghost mechanics, contribution areas
- `docs/architecture.md` — decided stack, Effect-ts orchestration layer, open questions

### Technical guides (read before writing code in that area)
- `docs/guides/effect-ts.md` — Effect service/Layer patterns, typed errors, ManagedRuntime wiring, request tracing

### Decision records
- `proposals/adr/0002-adopt-effect-ts.md` — why Effect-ts, migration phases, trade-offs
- `proposals/adr/README.md` — ADR format and process

### Feature specifications
- `specs/002-effect-ts-transition/` — current branch spec, plan, tasks, contracts, quickstart

## Contribution process

See `CONTRIBUTING.md` for workflow (branches, PRs, DCO sign-off).  
See `AGENTS.md` for agent-specific guidance on navigating and contributing to this repo.

## Key conventions

- All server dependencies are injected via Effect `Context.Tag` / `Layer`. No globals, no `if (!service)` guards.
- All domain failures use `Data.TaggedError`. Errors reaching HTTP must be covered in `server/src/errors.ts:errorToResponse()` with `Match.exhaustive`.
- DCO sign-off required: `git commit -s`
- Non-trivial work starts with an RFC or ADR before implementation.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->

## Recent Changes
- 009-ghost-house-a2a: Added TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `@a2a-js/sdk` 0.3.13+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `effect` v3+, `zod` 3, `ulid` (event IDs), `@aie-matrix/root-env` (shared env loading)
- 008-a2a-ghost-house-spike: Throwaway A2A spike sandbox under `spikes/a2a-ghost-agent-protocol/` (not in pnpm workspace). TypeScript 5.7 / Node.js 24 (ESM) + `@a2a-js/sdk` for SDK maturity and contributor-model exercises per `specs/008-a2a-ghost-house-spike/`.
- 006-ghost-conversation: Added TypeScript 5.7 / Node.js 24 (ESM, `"type": "module"`) + `effect` v3+, `@colyseus/core` 0.15.57, `@modelcontextprotocol/sdk` 1.29+, `zod` 3, `h3-js` (existing), `ulid` (new — message IDs)
