# Quickstart: Intermedium Polish

**Branch**: `014-intermedium-polish`

## Prerequisites

- `pnpm install` from repo root
- Backend running (`pnpm dev` from repo root starts Colyseus + World API + Agent Host)
- `clients/intermedium/.env.local` present with correct URLs (see `clients/intermedium/README.md`)

## Running the client

```bash
cd clients/intermedium
pnpm dev
# open http://localhost:5180
```

## Phase-by-Phase Verification

### Phase 1 — Neighborhood stop type foundations

```bash
# TypeScript must compile with zero errors after the type change
pnpm typecheck
```

Expected: no new TS errors. The `neighborhood` case is in `STOP_SEQUENCE`, `isExteriorStop`, `STOP_PITCH`, and `PanelView` no-panel guard.

### Phase 2 — Neighborhood stop camera + rendering

1. Open `http://localhost:5180`
2. Press `+` at Global — transitions to Regional (drill animation plays)
3. Press `+` again — transitions to Neighborhood: board fills ~70% of viewport at ~45° pitch, regional ring/landmark layers visible, no ghost markers
4. Press `+` again — transitions to Plan: overhead flat view, ghost markers visible if ghosts are active
5. Press `Escape` or `-` three times — returns to Global via Neighborhood and Regional

### Phase 3 — Chat UX

**Auto-scroll (FR-036)**:
1. Ensure the ghost has ≥ 5 messages in its thread
2. Navigate to Personal stop
3. Thread should be scrolled to the most recent message automatically — no manual scroll needed

**Auto-focus (FR-037)**:
1. Navigate to Personal stop
2. Browser cursor/caret should be in the message input immediately — typing should start without clicking

**Floating panel note (FR-038)**:
1. Navigate to Plan stop
2. Press `C` to open the floating chat panel
3. A note should appear near the top: "Full conversation view available at the Personal stop"
4. Close and navigate to Personal stop, open `C` panel — note should NOT appear

### Phase 4 — Global navigation hint (FR-039)

1. Open `http://localhost:5180` cold
2. Keyboard hint text should be visible at the bottom-center of the globe view (e.g., `+ / = zoom in · Esc back`)
3. Press `+` — hint disappears and does not reappear when returning to Global in the same session

### Phase 5 — Situational panel last message (FR-044)

1. Start with a ghost that has a conversation thread
2. Navigate to Situational stop focused on the paired ghost (requires `?ghost=<id>` or pairing)
3. The "Conversation view unlocks at Partner scale" stub should be replaced by the actual last message (sender label + truncated content)
4. If the paired ghost is not in the 7-hex cluster, the conversation section should not appear

### Phase 6 — Void platter boundary (FR-032)

1. Navigate to Plan stop
2. Open browser DevTools, set viewport to 1920×1080
3. No wireframe cells should appear outside the visible tile footprint of the map
4. A thin one-cell halo should be visible around the map edges only

### Phase 7 — Ghost last-move direction (optional)

1. With `?ghost=<id>` pointing to a moving ghost, navigate to Personal stop
2. The `GhostCard` should show a direction annotation (e.g., `↗ NE`) that updates as the ghost moves
3. If the ghost has not moved since page load, direction shows as `—`

## Typecheck + lint

```bash
# From repo root
pnpm typecheck
pnpm run lint
```

Both must pass before opening a PR.
