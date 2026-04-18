# aie-matrix

**The Matrix** is a hex-tile virtual world running in parallel with the [AI Engineer World's Fair](https://www.ai.engineer/worldsfair), where autonomous agents explore, learn, network, and compete as digital twins of their IRL counterparts. Every conference attendee can adopt a *ghost* — a personal agent that scouts sessions, exchanges cards, solves puzzles, and networks on their behalf while they're busy being human.

→ **[Project Overview](docs/project-overview.md)** — what it is, why it exists, and how it works  
→ **[Architecture](docs/architecture.md)** — tech stack, component map, open questions  
→ **[Contributing](CONTRIBUTING.md)** — how to get involved  
→ **[proposals/](proposals/)** — RFCs, ADRs, and design documents  
→ **Minimal PoC (001)** — [RFC-0001](proposals/rfc/0001-minimal-poc.md) · [ADR-0001](proposals/adr/0001-mcp-ghost-wire-protocol.md) · [Spec, contracts, tasks](specs/001-minimal-poc/)

## Directory guide

- **`client/`** — Browser client packages (Phaser spectator for the PoC).
- **`docs/`** — Product overview, architecture, and contributor-facing deep dives.
- **`ghosts/`** — Flat namespace for ghost-side code: MCP client SDKs, GhostHouse providers, compatibility kit; Python stub is planned here outside pnpm workspaces. See [`ghosts/README.md`](ghosts/README.md) for package naming (FR-019).
- **`maps/`** — Tiled map exports and tileset assets for the hex world (e.g. `maps/sandbox/` sandbox hex; expand per RFC-0001).
- **`proposals/`** — RFCs and ADRs: decisions and scope before implementation lands.
- **`server/`** — World backend packages (Colyseus room, MCP `world-api`, REST `registry`, dev `auth`) plus the combined PoC dev entry at `server/package.json`. The combined server package depends on **[Effect](https://effect.website/)** (`effect` v3+) for service wiring (`Layer` / `Context.Tag`), typed errors, and the shared `ManagedRuntime`; see [`docs/guides/effect-ts.md`](docs/guides/effect-ts.md).
- **`shared/`** — Cross-package TypeScript types and tool schemas consumed by server and clients.
- **`specs/`** — Feature folders: plans, contracts, quickstarts, and task lists (e.g. minimal PoC under `specs/001-minimal-poc/`).
- **`scripts/`** — Small repo-root helpers (e.g. `demo.mjs` for one-terminal PoC; `kill-poc-ports.mjs` to list or stop listeners on default PoC ports).

Root **`package.json`**, **`pnpm-workspace.yaml`**, and **`pnpm-lock.yaml`** define the pnpm monorepo; **`AGENTS.md`** summarizes repository rules for humans and automation.

Built for [AIEWF 2026](https://www.ai.engineer/worldsfair), June 29 – July 2, Moscone West, San Francisco.  

Contributions welcome from every vendor, sponsor, speaker, and attendee.

## Development (PoC monorepo)

The minimal PoC uses **pnpm** workspaces for TypeScript packages under `server/`, `client/phaser/`, `shared/types/`, and selected `ghosts/*` packages (see `pnpm-workspace.yaml`). Install dependencies from the repo root:

```bash
corepack enable   # optional; lets Node honor the packageManager field in package.json
pnpm install
```

The pinned pnpm version is declared in the root `package.json` `packageManager` field. **`ghosts/python-client/`** is a Python stub (`pyproject.toml`) and is not part of the pnpm workspace.

## Minimal PoC (001) — first run

Goal: combined server + Phaser spectator + reference ghost moving on the sample map. Detailed checks live in [`specs/001-minimal-poc/quickstart.md`](specs/001-minimal-poc/quickstart.md).

**Fewest steps from clone**: 

1. `git clone` → `cd` → **`pnpm install`**
2.  **`pnpm run demo --ghosts 5`** 
3. open the Vite **Local** URL from the log (often **http://localhost:5174/** or **http://127.0.0.1:5174/**). 

One terminal; **Ctrl+C** stops server, spectator, and 5 ghosts. Orchestration lives in [`scripts/demo.mjs`](scripts/demo.mjs). For debugging, use separate **`pnpm run server`**, **`pnpm run spectator`**, and **`pnpm run ghost:house`** shells instead.

### Human prerequisites (read before debugging code)

1. **Sample map (T004)** — The server loads a committed Tiled export. Required files under `maps/sandbox/`:
   - `freeplay.tmj` — navigable hex layer (default `AIE_MATRIX_MAP` in [`.env.example`](.env.example))
   - `color-set.tsx` — tileset metadata referenced by the TMJ
   - `rainbow-hexes.png` — tileset image referenced by the TSX  
   If these are missing or inconsistent, the combined server fails at startup with an explicit map error rather than silent bad behavior.
2. **Environment** — Optional: copy [`.env.example`](.env.example) to `.env` at the repo root for non-default ports or URLs. The `@aie-matrix/root-env` workspace package (`shared/root-env/`) loads `.env` for Node processes; Vite reads the same file for `VITE_*` keys (see `client/phaser/README.md`).
3. **Tooling** — Node **≥24** (see `engines`, [`.nvmrc`](.nvmrc), and [`.tool-versions`](.tool-versions); contributors use **24.14.1**); **pnpm `10.29.3`** from the root `packageManager` field. `corepack enable` (once per machine) lets Node install that pnpm version automatically.

### Typical commands (repo root)

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm dev` | **Watch-mode combined server** (same as `pnpm run server:dev`): runs `tsx watch` on `server/src/index.ts` after workspace prebuilds; HTTP + Colyseus on **http://127.0.0.1:8787** |
| `pnpm run demo` | **All-in-one**: `server` → wait for `/spectator/room` → `spectator` + `ghost:house` in parallel (single terminal; Ctrl+C stops children) |
| `pnpm run build` | Build every workspace package (first time or after large pulls) |
| `pnpm run server` | Combined server: HTTP + Colyseus on **http://127.0.0.1:8787** (runs `prestart` builds, then `node dist/index.js`) |
| `pnpm run server:dev` | Same as **`pnpm dev`**: combined server under `tsx watch` while editing server code |
| `pnpm run spectator` | Phaser spectator (Vite); default **http://127.0.0.1:5174** (see terminal for exact URL) |
| `pnpm run ghost:house` | `tsc` + `node` for `ghosts/random-house` (registers house, adopts, walks via MCP) |
| `pnpm run ghost:register` | One-shot: adopt a ghost and write `GHOST_TOKEN` to `.env` (run once before `ghost:cli`) |
| `pnpm run ghost:cli` | Interactive ghost CLI (Ink REPL) or one-shot subcommand, e.g. `ghost:cli -- whoami` |
| `pnpm run ports` | List processes **listening** on **8787** / **5174** / **5179** (`lsof`; safe, port-scoped) |
| `pnpm run ports:kill` | **SIGTERM** those listeners (orphaned server/spectator/ghost processes, Playwright `webServer`, or crashed demos). For **SIGKILL**, run `node scripts/kill-poc-ports.mjs --kill --force`. Override ports: `PORTS=8787,9090 pnpm run ports` |
| `pnpm run test:e2e` | Playwright smoke (starts server + Vite preview + one ghost); `pnpm run test:e2e:autostart` is the same; set `CI=1` in automation. E2E scripts run **`pnpm run install:browsers`** first because Playwright’s **Chromium binary is not installed by `pnpm install`** (it is cached on disk); see [`e2e/README.md`](e2e/README.md). |
| `pnpm run test:tck` | Minimal IC-006 smoke (**server must already be running**): registry + MCP `whereami` |

Registry-only `curl` flows (caretaker → house → adopt) for debugging are documented in [`server/registry/README.md`](server/registry/README.md).
