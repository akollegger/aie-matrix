# Quickstart: Minimal PoC

Verification backbone for [spec.md](./spec.md) user stories. All paths are from the **repository root** unless noted.

**Defaults**: HTTP + Colyseus **`http://127.0.0.1:8787`**, Phaser Vite dev **`http://127.0.0.1:5174`** (Vite may print **`http://localhost:5174/`** — same listener), registry under **`http://127.0.0.1:8787/registry/*`**. Override with `.env` / `AIE_MATRIX_HTTP_PORT` (see [`.env.example`](../../.env.example)).

### One command (happy path)

After **`pnpm install`**:

```bash
pnpm run demo
```

This runs **`pnpm run server`** (combined server), waits until **`GET /spectator/room`** succeeds, then starts **`pnpm run spectator`** (Phaser), **`@aie-matrix/ghost-house`**, and **`@aie-matrix/random-agent`**. Open the Vite URL from the terminal; **Ctrl+C** stops all child processes. Pass **`pnpm run demo -- --ghosts N`** to provision *N* registry caretakers + wanderer sessions (default `1`; see `scripts/demo.mjs --help`). Use separate **`pnpm run server`**, **`pnpm run spectator`**, and ghost-house / random-agent terminals when you want cleaner logs or to restart one surface without the others.

---

## 1. Ghost end-to-end (User Story 1)

**Goal**: Registry + MCP movement for the reference house; one successful `go` and one structured rejection in normal use.

1. **Install** (first time on a machine; ~2–5 min depending on network):

   ```bash
   corepack enable   # once per machine, if supported
   pnpm install
   ```

2. **Bring up the stack** — either:

   - **One terminal** — `pnpm run demo` (see [One command](#one-command-happy-path) above), **or**
   - **Split terminals** — combined server first (first cold start ~1–3 min while `prestart` builds deps; later starts are faster):

     ```bash
     pnpm run server
     ```

     For day-to-day server hacking (watch + reload):

     ```bash
     pnpm run server:dev
     ```

3. **GhostHouse + adoption** (skip if you already used **`pnpm run demo`**, which starts the ghost for you) — either:

   - **Script-first** — from a **second** terminal (unless `demo` is running):

     ```bash
     pnpm run ghost:house
     ```

     Multi-ghost on one process (two caretakers, one house):

     ```bash
     pnpm --filter @aie-matrix/ghost-random-house start -- --ghosts 2
     ```

   - **Raw HTTP (registry debugging)** — same sequence `random-house` performs; see [server/registry/README.md](../../server/registry/README.md).

4. **Verify with ghost-cli (optional)** — after adoption, exercise the same MCP tools from a shell (requires the combined server still running):

   ```bash
   export GHOST_TOKEN=<token from adoption output>
   export WORLD_API_URL=http://127.0.0.1:8787/mcp
   pnpm run ghost:cli -- whoami
   ```

   See [specs/004-ghost-cli/quickstart.md](../004-ghost-cli/quickstart.md) for one-shot commands, JSON output, and the interactive REPL.

5. **Watch MCP traffic** — `random-house` logs `whoami`, `whereami`, `exits`, and each `go`. Invalid moves surface as tool errors or structured `ok: false` per [contracts/ghost-mcp.md](./contracts/ghost-mcp.md).

**Smoke**: At least one `go` succeeds and the ghost keeps moving; if you force an illegal direction, the world rejects without corrupting stored tile (see server logs / MCP response).

---

## 2. Spectator browser (User Story 2)

**Goal**: Read-only map + ghost markers synced from Colyseus within ~1s of accepted moves (SC-003).

1. With **`pnpm run server`** (or `pnpm run server:dev`) already running, open a **third** terminal:

   ```bash
   pnpm run spectator
   ```

2. Open the **Local** URL Vite prints (default **http://127.0.0.1:5174/**). There are **no** move controls in the UI.

3. With **`pnpm run ghost:house`** (or `pnpm --filter @aie-matrix/ghost-random-house start -- --ghosts 2`) running, confirm markers move without refreshing.

4. **Debug hook** — append **`?debug=1`** for extra HUD / logs (`window.__aieSpectatorE2e` for Playwright). See `client/phaser/README.md`.

**Two ghosts**: `pnpm --filter @aie-matrix/ghost-random-house start -- --ghosts 2` **or** two shells each running `pnpm run ghost:house` (two separate GhostHouse registrations).

---

## 3. Contributor setup ≤ 15 minutes (User Story 3)

**Goal** (SC-001): On a prepared laptop (Node 24+, pnpm, browser), clone → install → server → client → ghost → visible motion without reading `server/` internals.

1. Confirm [Human prerequisites](../../README.md#human-prerequisites-read-before-debugging-code) in the root `README.md` (map files + optional `.env`).
2. Follow **§1** and **§2** above in order, using the root scripts in the [main README](../../README.md#typical-commands-repo-root) where helpful.
3. If something fails, check: port **8787** free; map paths under `maps/sandbox/` present; first **`pnpm run server`** allowed to finish `prestart` builds.

---

## 4. Compatibility check (User Story 4)

With the combined server already running (**`pnpm run server`**, **`pnpm run demo`**, etc.):

```bash
pnpm --filter @aie-matrix/ghost-tck test
```

**Scope (minimal)** — [contracts/tck-scenarios.md](./contracts/tck-scenarios.md): **reachability** (`GET /spectator/room`) → **registry adopt** → **MCP `whereami`**. Exit **0** only if all succeed; stderr lines are prefixed with **`[tck]`**. This does **not** replace Playwright, `random-house`, or manual §1 movement smoke; broader checks are **out of scope** for PoC Phase 6 (see [`ghosts/tck/README.md`](../../ghosts/tck/README.md)).

Skip this section for the fastest §1–§3 walkthrough if you prefer; it is a small extra gate for CI or pre-push.

---

## Walkthrough log

Dry-run notes (maintainer, **2026-04-13**, existing dev laptop with warm `pnpm` store — times are **indicative**; first cold clone will be slower):

| Step | Command / action | Approx. time |
|------|-------------------|--------------|
| Clone | `git clone … && cd aie-matrix` | 1–2 min |
| Install | `pnpm install` | 2–4 min (network) |
| All-in-one (optional) | `pnpm run demo` (server + Vite + `random-house`) | first run ~3–6 min incl. builds; Ctrl+C stops all |
| Server | First `pnpm run server` (includes `prestart` builds) | 2–4 min |
| Later server | Subsequent `pnpm run server` / `pnpm run server:dev` | &lt; 30 s |
| Client | `pnpm run spectator` (runs `predev` / `copy-map-assets`) | &lt; 1 min to ready URL |
| Ghost | `pnpm run ghost:house` | ~30–60 s including `tsc` |
| Browser | Open Vite URL, confirm motion | 1–2 min |

**Gaps addressed during this pass**: Root `README.md` lists map artifacts and repo-root scripts; this file replaces placeholder commands; registry `curl` flow lives in `server/registry/README.md`; **`pnpm --filter @aie-matrix/ghost-tck test`** implements minimal Phase 6 smoke (see [contracts/tck-scenarios.md](./contracts/tck-scenarios.md)); the 15-minute path still does not require it.

---

## Related artifacts

- [contracts/](./contracts/)
- [research.md](./research.md)
- [data-model.md](./data-model.md)
