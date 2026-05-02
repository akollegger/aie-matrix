---
name: gram-lint
description: Validate gram notation snippets or files using the gram-lint CLI. Use whenever you need to check whether a gram expression or .map.gram file is syntactically valid — especially when designing format changes, reviewing example files, or verifying that proposed snippets are parseable by the WASM grammar.
---

# gram-lint

## Overview

`gram-lint` is a CLI that validates gram notation against the canonical grammar.
- Exit 0 + no output = valid
- Exit 1 + annotated error = invalid, with position and token shown

## Validating an inline expression

Use `-e` for snippets that live in the conversation. Each `-e` flag is one gram
expression; use multiple flags for multi-statement documents:

```bash
gram-lint -e '(floor:TileType:Floor { name: "Floor" })'
gram-lint \
  -e '{ kind: "matrix-map", name: "test", elevation: 0 }' \
  -e '(floor:TileType:Floor { name: "Floor" })' \
  -e '(cell-8f283082aa20c00:Cell:Floor { geometry: [h3`8f283082aa20c00`] })'
```

## Validating a file

Pass one or more file paths directly:

```bash
gram-lint maps/sandbox/canonical.map.gram
gram-lint maps/sandbox/*.map.gram
```

## Inspecting the parse tree

Add `--tree` to see the s-expression parse tree — useful when checking how the
grammar interprets a new construct (arrays, walk syntax, tagged strings, etc.):

```bash
gram-lint --tree -e '[floors:Layer | poly-1, poly-2]'
gram-lint --tree -e '(cell:Floor { geometry: [h3`8f283082aa20c00`] })'
```

## Workflow

1. Identify the gram snippet(s) or file(s) to validate.
2. Run `gram-lint` via the Bash tool.
3. If exit 0 and no output: report the snippet as **valid**.
4. If exit 1: show the error output verbatim and identify the offending token or
   construct. Do not guess at validity — the linter is authoritative.
5. When designing new format constructs, use `--tree` to confirm how the grammar
   classifies the construct (node_pattern, subject_pattern, array, tagged_string,
   etc.) before committing to it.

## Notes

- `gram-lint` validates *syntax only* — it does not check semantic constraints
  (e.g. whether a referenced node id exists, or whether geometry arrays have the
  right length). Those checks remain in application code.
- Multi-line expressions can be passed as a single `-e` argument using `$'...'`
  shell quoting or a heredoc piped to stdin (`gram-lint -`).
- The linter is authoritative over `Gram.validate()` from `@relateby/pattern` —
  prefer it for format design decisions since it gives line/column errors.
