# Repository Guidelines

## Project Structure & Module Organization
This repository is currently specification-first and documentation-heavy. Start with `README.md`, then read `docs/project-overview.md` for product context and `docs/architecture.md` for the decided stack and open design questions. Use `proposals/adr/` for architecture decisions and `proposals/rfc/` for feature proposals; both directories define the required file format in their local `README.md`. Keep new top-level directories rare and justified in a proposal.

## Build, Test, and Development Commands
The PoC TypeScript monorepo uses **pnpm** (`pnpm-workspace.yaml` at the repo root). Install with `pnpm install` from the repository root; run package scripts with `pnpm run <script>` inside a workspace package or use `pnpm --filter <package> run <script>` from the root.

There is no full application build pipeline yet beyond workspace scaffolding. The core documentation workflow is reading, proposing, and reviewing:

```bash
rg --files
git status
git commit -s -m "docs: add ghost memory RFC"
```

Use `rg --files` to inspect the repo quickly, `git status` to confirm your change set, and `git commit -s` because DCO sign-off is required for all commits. When you add runnable code, document local setup and smoke-test commands in the package-level `README.md` and keep examples on **pnpm** (not `npm`/`yarn`).

## Coding Style & Naming Conventions
Write Markdown with short sections, explicit headings, and direct language. Match existing filename patterns:

- ADRs: `proposals/adr/NNNN-short-title.md`
- RFCs: `proposals/rfc/NNNN-short-title.md`
- Branches: `feature/<short-description>`, `fix/<short-description>`, `proposal/<short-description>`

Prefer lowercase kebab-case for new document filenames. Keep examples concrete and repository-specific.

## Testing Guidelines
There is no formal automated test suite yet. For documentation changes, verify internal links, heading structure, and consistency with `README.md`, `docs/architecture.md`, and `CONTRIBUTING.md`. For future code contributions, include at least a smoke test and document how to run it.

## Commit & Pull Request Guidelines
This repository has no commit history yet, so follow the conventions defined in `CONTRIBUTING.md`. Use imperative, scoped commit messages such as `docs: add vendor NPC RFC` or `adr: choose event log backend`, always with `-s`. Open pull requests from feature branches, reference the related issue or proposal, and include enough context for review. Non-trivial work should begin with an RFC or ADR before implementation.

## Active Technologies
- **pnpm** workspaces for the TypeScript monorepo; TypeScript on Node.js **24+** for `server/*`, `client/phaser`, `shared/types`, and `ghosts/*` packages; Python 3.11+ for `ghosts/python-client/` stub only. + Colyseus (authoritative room + WebSocket broadcast to spectators); Phaser 3 (spectator); MCP server/client libraries for `world-api` and SDKs; minimal HTTP stack for `registry` and static or dev-server delivery of Phaser build; JWT handling in `auth` (dev secret for PoC). (001-minimal-poc)
- N/A for PoC — in-memory Colyseus room state and ephemeral registry/adoption data unless a later task introduces a tiny on-disk fixture. (001-minimal-poc)

## Recent Changes
- 001-minimal-poc: Standardized on **pnpm** workspaces (`pnpm-workspace.yaml`, `pnpm-lock.yaml`); TypeScript on Node.js **24+** for `server/*`, `client/phaser`, `shared/types`, and `ghosts/*` packages; Python 3.11+ for `ghosts/python-client/` stub only. + Colyseus (authoritative room + WebSocket broadcast to spectators); Phaser 3 (spectator); MCP server/client libraries for `world-api` and SDKs; minimal HTTP stack for `registry` and static or dev-server delivery of Phaser build; JWT handling in `auth` (dev secret for PoC).
