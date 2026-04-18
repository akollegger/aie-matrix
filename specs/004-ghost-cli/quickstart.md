# Ghost CLI — Local Development Quickstart

**Spec**: [spec.md](./spec.md) | **Package**: `@aie-matrix/ghost-cli` at `ghosts/ghost-cli/`

---

## Prerequisites

- Combined server running: `pnpm run server` (from repo root)
- Node.js 24, pnpm 10 installed

---

## Step 1 — Register a ghost and configure credentials

```bash
# One-shot: adopts a ghost and writes GHOST_TOKEN (and WORLD_API_URL if unset) to .env
pnpm run ghost:register
```

This writes credentials to `.env` at the repo root. No manual copy-paste needed.

If you prefer to set credentials manually:

```bash
export GHOST_TOKEN=<token>
export WORLD_API_URL=http://127.0.0.1:8787/mcp
```

---

## Step 2 — Build the CLI

```bash
pnpm --filter @aie-matrix/ghost-cli run build
```

---

## Step 3 — Verify with one-shot commands

```bash
# Confirm identity (from repo root you can use: pnpm run ghost:cli -- whoami)
pnpm --filter @aie-matrix/ghost-cli start -- whoami

# Check current position as JSON
pnpm --filter @aie-matrix/ghost-cli start -- whereami --json

# List exits
pnpm --filter @aie-matrix/ghost-cli start -- exits

# Inspect current tile
pnpm --filter @aie-matrix/ghost-cli start -- look here

# Move northeast
pnpm --filter @aie-matrix/ghost-cli start -- go ne
```

Expected: each command prints a human-readable result and exits 0.

---

## Step 4 — Launch the interactive REPL

```bash
pnpm --filter @aie-matrix/ghost-cli start
```

You should see:
- A green `● CONNECTED` status strip at the top
- The World View panel (current tile description)
- The Ghost panel (ghost identity and position)
- The Exits panel (available directions)
- The `> _` input prompt at the bottom

Try these commands:
```
look around
go ne
exits
help
```

Press `Ctrl-C` or type `exit` to quit.

---

## Step 5 — Verify the diagnostic layer

Test each pre-flight phase by simulating the failure condition:

```bash
# Phase 1: missing token
unset GHOST_TOKEN
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# Expected: "No ghost token. Run `pnpm run ghost:register`…"

# Phase 2: server not running (stop the server first)
export GHOST_TOKEN=<any-value>
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# Expected: "The world server isn't running at 127.0.0.1:8787. Start it with pnpm run server."

# Phase 1: wrong URL format
export GHOST_TOKEN=<valid-token>
export WORLD_API_URL=http://127.0.0.1:8787
pnpm --filter @aie-matrix/ghost-cli start -- whoami
# Expected: "The URL … looks like a server base URL. Try …/mcp."
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `GHOST_TOKEN` warning on startup | Token not set | See Step 1 |
| Connection refused | Server not running | `pnpm run server` |
| Token rejected | Server was restarted (tokens expire) | `pnpm run ghost:register` again |
| Ghost not found | Ghost was evicted after restart | `pnpm run ghost:register` again |
| Interactive UI not rendering | stdout is not a TTY | Use one-shot mode or run in a real terminal |

For raw protocol-level debugging:
```bash
pnpm --filter @aie-matrix/ghost-cli start -- whoami --debug
```

---

## Running typechecks and tests

```bash
pnpm --filter @aie-matrix/ghost-cli run typecheck
pnpm --filter @aie-matrix/ghost-cli run test
```
