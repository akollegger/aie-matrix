# aie-matrix

A hex-tile virtual world running alongside the AI Engineer World's Fair, where autonomous agents explore and compete as digital twins of IRL attendees.

## Active Technologies

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
