# Quickstart: Rule-Based Movement (planned implementation)

Verification backbone for [spec.md](./spec.md) once code lands. Paths are from the **repository root** unless noted.

## Prerequisites

- Same PoC stack as [001-minimal-poc quickstart](../001-minimal-poc/quickstart.md): `pnpm install`, combined server, optional Phaser + ghost.
- A **Gram rules file** checked in (e.g. `server/world-api/rules/demo-asymmetric.gram`) and configuration pointing the world API at **authored** rules mode (exact env key will match implementation — see `server/world-api/README.md` when added).

## 1. Parse smoke (developer)

After implementation, this should succeed without starting Colyseus:

```bash
pnpm --filter @aie-matrix/server-world-api exec node --import tsx ./scripts/parse-rules-smoke.mjs
```

*(Script path is illustrative; add the real script in the implementation PR.)*

Expected: prints pattern count, exits 0. Non-zero on Gram errors.

## 2. Asymmetric two-class demo (User Story 3)

1. Start the server with the **demo rules** + sample map containing tile classes **A** and **B** matching the rules (see fixture comments in the `.gram` file).
2. Spawn a ghost on class **A**, `go` into **B**, move **B → B**, then attempt **B → A**.
3. Assert: first two moves succeed; third returns denied with `code` present and ghost still on **B**.

**Automation**: Prefer a unit test in `server/world-api` calling `evaluateGo` with a small in-memory `LoadedMap` fixture + parsed rules; optionally extend `ghost-tck` if an HTTP-level check is needed.

## 3. Permissive mode regression

Toggle configuration to **permissive** rules mode. Repeat geometrically valid moves: none should fail with `RULESET_DENY`.

## 4. Documentation to update in the implementation PR

- `server/world-api/README.md` — rules file location, env vars, failure modes.
- `docs/architecture.md` — short subsection on “ruleset vs map” if not already covered elsewhere.
- Ghost / TCK docs — new or refined `RULESET_DENY` subcodes if introduced.
