# IC-003: `tmj-to-gram` CLI Interface Contract

**Contract ID**: IC-003  
**Feature**: `012-tmj-to-gram`  
**Related RFC**: `proposals/rfc/0009-map-format-pipeline.md`

## Purpose

Defines the command-line interface of `@aie-matrix/tmj-to-gram` so that CI scripts, Makefile targets, and developer workflows can invoke the tool without inspecting its source.

## Invocation

```bash
pnpm tmj-to-gram convert <tmj-path> [--out <output-path>]
```

The tool is invoked via the workspace `pnpm` script. The `convert` subcommand is the only supported subcommand in this RFC.

## Arguments and Flags

| Name | Kind | Required | Description |
|---|---|---|---|
| `<tmj-path>` | positional | yes | Path to the `.tmj` file to convert. Relative paths are resolved from the current working directory. |
| `--out <output-path>` | flag | no | Path for the output `.map.gram` file. When omitted, output is written to `<tmj-path-stem>.map.gram` (replacing the `.tmj` extension in the same directory). |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Conversion succeeded. Output file written. |
| 1 | Input validation failure (missing `h3_anchor`, wrong `h3_resolution`, `--out` path not writable, etc.). |
| 2 | Conversion error: ellipse object detected, polygon vertex in gutter, overlapping tile-area objects, or other geometry failure. |
| 3 | I/O error: input file not found, tileset file not readable, output directory does not exist. |

## Stderr Output

All diagnostic output goes to stderr. Stdout is reserved for future machine-readable output (none in this RFC).

### Warning messages

Warnings are prefixed with `[warn]` and do not cause a non-zero exit:

```
[warn] Ignoring portal object id=<id> name=<name> at (<x>,<y>) — portals are out of scope.
[warn] tile-area object id=<id> name=<name> has unknown type "<type>" (not found in any .tsx tileset).
[warn] layout layer cell at (<col>,<row>) has unknown tile type "<type>" — emitted with label as authored.
```

### Error messages

Errors are prefixed with `[error]` and cause a non-zero exit. The conversion stops at the first fatal error (exit code 1 or 2) or after reporting all I/O errors (exit code 3).

```
[error] Missing required map property "h3_anchor" in <tmj-path>.
[error] h3_resolution must be 15, got <value> in <tmj-path>.
[error] tile-area object id=<id> name=<name> is an ellipse. Ellipses are not supported. Remove or replace with a polygon.
[error] tile-area object id=<id> vertex <index> at pixel (<px>,<py>) falls in the gutter between hexes.
[error] tile-area overlap detected: object id=<id1> and id=<id2> share <n> cell(s). Non-overlapping areas are required.
[error] Tileset file "<path>" referenced in <tmj-path> could not be read: <os-error>.
[error] Output path "<path>" is not writable: <os-error>.
```

## Implicit Input Resolution

The tool locates companion files using filename-stem conventions:

| File | Location rule |
|---|---|
| `*.items.json` sidecar | Same directory as the `.tmj`, same stem: `freeplay.tmj` → `freeplay.items.json`. Missing sidecar is not an error. |
| `*.tsx` tileset files | Paths are read from the `.tmj`'s `tilesets[].source` fields; resolved relative to the `.tmj` file's directory. |

## CI Usage Pattern

```bash
# Regenerate all sandbox gram files
for tmj in maps/sandbox/*.tmj; do
  pnpm tmj-to-gram convert "$tmj"
done

# Byte-equality check (CI step)
for tmj in maps/sandbox/*.tmj; do
  stem="${tmj%.tmj}"
  pnpm tmj-to-gram convert "$tmj" --out /tmp/check.map.gram
  diff -q "$stem.map.gram" /tmp/check.map.gram || (echo "Drift detected for $tmj" && exit 1)
done
```

## Versioning

The CLI is a workspace-internal tool. Its interface contract is versioned alongside the feature branch. Breaking changes to flags or exit codes require updating this contract document and the CI scripts that reference it.
