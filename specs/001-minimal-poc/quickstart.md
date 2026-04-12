# Quickstart: Minimal PoC (planned)

This file is the **verification backbone** for the feature spec user stories. Commands are placeholders until the monorepo scaffold lands; after implementation, replace with exact scripts and ports.

## 1. Ghost end-to-end (User Story 1)

1. From `/Users/akollegger/Developer/akollegger/aie-matrix`, install and build per root `README.md`.
2. Start the server bundle: `cd server && npm run dev` (RFC naming).
3. Execute the documented adoption script / `curl` sequence to register **`ghosts/random-house/`** as a GhostHouse and adopt a ghost for a dev caretaker.
4. Start **`ghosts/random-house/`** per package README.
5. Confirm MCP-only navigation: valid move succeeds; invalid neighbor or capacity move returns explicit rejection without position corruption.

**Smoke**: One successful `move_ghost` and one rejected move logged or visible via MCP client traces.

## 2. Spectator browser (User Story 2)

1. With server running, open the documented spectator URL.
2. Confirm map renders with **no** write controls.
3. With one ghost active, confirm position updates without manual refresh.
4. Repeat with two ghosts (two `random-house` instances or documented multi-ghost path).

## 3. Contributor setup ≤ 15 minutes (User Story 3)

1. Time-boxed walkthrough from clean clone following `README.md` + this file.
2. Confirm all **manual prerequisites** (map authoring, env files) are listed with expected outputs before deep debugging.

## 4. Compatibility check (User Story 4)

1. With server running: `cd ghosts/tck && npm test`.
2. For cross-language story: point TCK at alternate implementation only after IC-006 parameters for substituting the house or ghost process are defined in `tck` README.

## Related artifacts

- Contracts: `/Users/akollegger/Developer/akollegger/aie-matrix/specs/001-minimal-poc/contracts/`
- Research decisions: [research.md](./research.md)
- Data model: [data-model.md](./data-model.md)
