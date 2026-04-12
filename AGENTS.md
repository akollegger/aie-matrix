# Repository Guidelines

## Project Structure & Module Organization
This repository is currently specification-first and documentation-heavy. Start with `README.md`, then read `docs/project-overview.md` for product context and `docs/architecture.md` for the decided stack and open design questions. Use `proposals/adr/` for architecture decisions and `proposals/rfc/` for feature proposals; both directories define the required file format in their local `README.md`. Keep new top-level directories rare and justified in a proposal.

## Build, Test, and Development Commands
There is no application build pipeline in this repository yet. The core workflow is reading, proposing, and reviewing:

```bash
rg --files
git status
git commit -s -m "docs: add ghost memory RFC"
```

Use `rg --files` to inspect the repo quickly, `git status` to confirm your change set, and `git commit -s` because DCO sign-off is required for all commits. If you add runnable code later, document its local setup and smoke-test command in the package-level `README.md`.

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
