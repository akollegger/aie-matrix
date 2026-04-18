# `ghosts/` — flat namespace (FR-019)

All ghost-side code lives here as **sibling packages** — no nested subtype trees (for example no `ghosts/providers/random-house/`). See [FR-019](../specs/001-minimal-poc/spec.md) in the Minimal PoC spec.

## Naming

| Pattern | Role |
|---------|------|
| **`ghosts/<name>-client/`** | MCP client SDKs for ghost authors (TypeScript today; others welcome). |
| **`ghosts/<name>-house/`** | Runnable GhostHouse: register with the registry, adopt/provision ghosts for caretakers, run ghost processes. |
| **`ghosts/tck/`** | Minimal compatibility smoke against a **live** stack ([`contracts/tck-scenarios.md`](../specs/001-minimal-poc/contracts/tck-scenarios.md)). |

The reference house is **`random-house/`** (not `random-house-house/`) — historical name; it still satisfies the “one runnable house package per folder” rule.

## Packages in this repo (PoC)

| Path | pnpm workspace | Notes |
|------|----------------|--------|
| [`ts-client/`](./ts-client/) | `@aie-matrix/ghost-ts-client` | Streamable HTTP MCP client used by houses and TCK. |
| [`random-house/`](./random-house/) | `@aie-matrix/ghost-random-house` | Registers, adopts, random-walks via MCP. |
| [`ghost-cli/`](./ghost-cli/) | `@aie-matrix/ghost-cli` | Interactive REPL and one-shot CLI for human-operated ghost debugging. |
| [`tck/`](./tck/) | `@aie-matrix/ghost-tck` | `pnpm run test` — server must already be listening. |
| [`python-client/`](./python-client/) | *(none — Python only)* | Stub / future SDK; see `pyproject.toml`. |

Other dirs (e.g. `tck/` tooling only) follow the same flat rule: add new **`ghosts/<short-name>-{house,client}/`** siblings rather than nesting under existing packages.

## Related

- [RFC-0001](../proposals/rfc/0001-minimal-poc.md) — layout and goals  
- [Minimal PoC quickstart](../specs/001-minimal-poc/quickstart.md) — verification order  
