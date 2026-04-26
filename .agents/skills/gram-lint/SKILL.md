---
name: gram-lint
description: Validates Gram notation files and inline snippets using the gram-lint CLI (parse errors, optional s-expression tree). Use when editing or generating .gram files, debugging Gram.parse failures, validating converter output, or when the user mentions gram-lint, Gram syntax, or linting gram documents.
---

# gram-lint

## Prerequisites

- **Binary**: `gram-lint` on `PATH` (common install: `cargo install gram-lint`).
- **Version**: Run `gram-lint -V` if behavior differs; this skill matches `gram-lint --help` as of 0.3.x.

If the command is missing, say so and install or use another validation path (e.g. `@relateby/pattern` `Gram.validate` in Node) instead of guessing flags.

## When to use it

- After authoring or editing `*.gram` (maps, rules, fixtures).
- Before committing CLI-generated artifacts (e.g. `*.map.gram`).
- Quick checks on **snippets** from RFCs, tests, or chat without writing a temp file.
- When parse errors are unclear: add `-t` to inspect the parse tree.

## Commands

### Lint one or more files

```bash
gram-lint path/to/a.gram path/to/b.gram
```

- **Exit 0**: all files parse.
- **Exit non-zero**: at least one file failed; stderr shows file path, line/column, and message.

### Lint from stdin

```bash
gram-lint -              # explicit stdin
cat file.gram | gram-lint   # omit FILE args; stdin is read
```

Use stdin for heredocs, `printf`, or piped converter output.

### Lint inline expressions (`-e`)

Repeatable; each expression is linted independently.

```bash
gram-lint -e '(id:TileType:Label { name: "x" })'
gram-lint -e '(a:Foo { x: 1 })' -e '(b:Bar { y: 2 })'
```

Good for **vertices**, **headers**, or single nodes extracted from a larger document.

### Parse tree (`-t`)

```bash
gram-lint -t file.gram
gram-lint -t -e '[area:Polygon:Type | h8f2800000000000, h8f2800000000122]'
```

Prints an s-expression-style tree of the parse. Use for debugging ambiguous syntax, not for routine CI (noisy).

## Agent workflow

1. Prefer **file lint** when the `.gram` already exists on disk.
2. Prefer **`-e`** for one-line repros from specs or failing tests.
3. On failure, re-run with **`-t`** only if the error message is insufficient.
4. Treat **exit code** as the gate: scripts should use `set -e` / check `$?` after `gram-lint`.

## Relationship to in-repo validation

- **gram-lint**: fast, CLI, no Node/`effect` stack; good pre-commit and agent smoke checks.
- **`Gram.parse` / `Gram.validate` (`@relateby/pattern`)**: what runtime code uses; still required where the app depends on decoded patterns, not just syntax.

Use both when a change must satisfy the WASM parser **and** downstream consumers.

## Anti-patterns

- Do not assume `gram-lint` is installed in every environment; probe or document missing binary.
- Do not replace project test suites with gram-lint alone; it checks **syntax**, not semantic invariants (H3 validity, map rules, etc.).
