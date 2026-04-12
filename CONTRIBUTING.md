# Contributing to aie-matrix

Welcome. This project is a cross-organization collaboration open to every vendor, sponsor, and speaker at the AI Engineer World's Fair. The goal is a working system by June 29, 2026 — not a prototype.

## How to Get Involved

1. **Read the [Project Overview](docs/project-overview.md)** to understand what we're building.
2. **Browse [open issues](../../issues)** and **[proposals/](proposals/)** to see what's in flight.
3. **Pick a contribution area** — infrastructure, game mechanics, agent architecture, memory modules, frontend, eval, and more. See the overview for a full map.
4. **Open an issue or start a discussion** before writing code. The best contributions begin with a short spec.

## Workflow

### Specification-First Development

All non-trivial contributions start with a written spec before implementation. This keeps the collaboration legible across organizations and time zones.

- For **significant design decisions**, open an [ADR (Architecture Decision Record)](proposals/adr/README.md) in `proposals/adr/`.
- For **new features or components**, open an [RFC](proposals/rfc/README.md) in `proposals/rfc/`.
- For **small, well-understood changes**, a clear PR description is sufficient.

Specs don't need to be long. A few paragraphs stating the problem, the proposed solution, and the alternatives considered is enough to start a conversation.

### Branches and Pull Requests

- All work happens on **feature branches**, branched from `main`.
- Branch naming: `feature/<short-description>`, `fix/<short-description>`, `proposal/<short-description>`.
- All merges go through **pull requests**. No direct commits to `main`.
- PRs should reference the issue or proposal they address.
- At least one review from a maintainer is required before merge.

### Commit Sign-Off (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/). Add a sign-off to your commits:

```
git commit -s -m "your commit message"
```

This adds a `Signed-off-by` line certifying that you have the right to submit the contribution under the project license. It is not a CLA — no agreement to sign.

### Code Style and CI

- CI checks run on every PR. All checks must pass before merge.
- Language-specific style guides are in each package's README.
- If you're contributing a new package or module, include a `README.md` and at least a smoke test.

## License

This project is licensed under the **MIT License**. By contributing, you agree that your contributions will be released under the same license.

## Questions

Open a [Discussion](../../discussions) or drop into the project Discord. If you're a vendor or sponsor looking to contribute a module (memory, NPC agent, observability, etc.), open an issue tagged `vendor-contribution` and we'll help you find the right surface.
