# RFC-0028: In-World Vendors & the Cypher Economy

- **Status:** Draft (for review)
- **Author:** henrardo (peppers)
- **Date:** 2026-06-15
- **Affects:** `server/world-api` (substrate — needs owner sign-off), `ghosts/peppers-*` (boil), `maps/props/` (new sample content)
- **Related:** RFC-0023 (in-world resource ledger), RFC-0027 (cosmic elevators), [[project_overeating_chronic_harm]], the reincarnation flow (death-reflection grounding)

## Summary

Turn the world into a **resource-constrained environment**. There is no free, generic "food". Instead there are *priced, differentiated* foods — `bread`, `cake`, `salad`, `coffee`, … — that an agent must **buy with Cyphers** (agent money) from **vendor props** scattered through the venue: vending machines, coffee carts, sandwich bars, and more.

Every meal is a trade: spend a scarce resource (Cyphers) to gain a need (Fuel), and the *cheapest* fuel (cake, soda) carries the *highest* long-term cost (metabolic strain + appetite tolerance — the existing chronic-overeating mechanic). Scarcity + asymmetric tradeoffs are the substrate for emergent economic behaviour: budgeting, queueing at busy vendors, choosing cheap-and-harmful vs expensive-and-healthy, stockpiling, sharing.

Vendors are **droppable components**, not map architecture: a map-agnostic prop pack (`maps/props/concession.items.json`) is layered into a run and scattered onto navigable cells at startup via the *existing* runtime item-spawn seam — no `.map.gram` edit. Each vendor conducts **exactly one transaction at a time**, enforced by a per-vendor lock in the single-threaded, authoritative Colyseus room state.

## Motivation

1. **Deaths are currently uniform starvation.** There is no foraging; every ghost dies on the cumulative `STARVATION_DEATH_CASCADES` clock. The reincarnation death-reflection then *confabulates* a psychological cause ("what could you have done differently?") because there is no mechanical cause to point at. An economy gives starvation a real, chosen cause: *"I spent my Cyphers on cake and couldn't afford a real meal."* That is exactly the grounded answer the karmic-word reflection was missing.
2. **Resource constraint creates behaviour.** A free-food world has no decisions in it. A priced world with finite money and asymmetric foods forces tradeoffs — and tradeoffs are where personality and free will show up (the emergent-behaviour roadmap). This is mechanism, not prescription: we add scarcity + consequences and let the choices emerge.
3. **The pieces already exist.** The ledger (RFC-0023) does idempotent, conserved, double-entry transfers. The item system already spawns consumables at runtime and feeds `tokens` into Fuel on `consume`. The overeating/strain mechanic already punishes calorie-dense bingeing. This RFC mostly *composes* existing substrate behind one new tool + one lock.

## Design

### 1. Currency: `cypher` (a conserved ledger resource)

Cyphers are just a `ResourceType` (`shared/types/src/ledger.ts`):

```ts
{ id: "cypher", class: "conserved", qty: <seed>, floor: 0, label: "Cyphers" }
```

Conserved means the total is fixed and never minted — money moves between bags, it doesn't appear. Debits use the existing path: `LedgerService.quote()` to check affordability, `LedgerService.commit()` with a `from: ghost, to: vendor` transfer (`server/world-api/src/LedgerService.ts`). Idempotency, conservation, and the hash chain come for free.

> Naming note: `cypher` (the in-world currency) is a plain data string and never collides with Cypher the query language. It is also on-theme for the Matrix-House arc.

**How Cyphers enter the world / how ghosts earn them** is the one genuinely open economic question — see *Open Questions*. The MVP proposal: a **spawn stipend** (each new life starts with a wallet) plus optional earning hooks (`mechanics.ts:rewardGold`-style credits for social/【world】 achievements). A finite stipend with limited earning is what makes the constraint bite.

### 2. Foods: priced, differentiated consumables

Foods are ordinary `ItemDefinition`s (`shared/types/src/items.ts`) — `carriable: true`, `tokens` = Fuel delivered on `consume` (the existing wiring at `run-loop.ts` ~L774). What's new is the **economic + physiological profile in `attrs`** (the existing open-ended authoring map):

| attr | meaning | consumed by |
|------|---------|-------------|
| `price` | base cost in Cyphers | vendor stock (overridable per vendor) |
| `strain` | metabolic-strain delta per consume (cake +0.6, salad −0.2) | peppers `consume` wiring |
| `tol` | appetite-tolerance pressure 0..1 (drives the addiction/setpoint drift) | peppers `consume` wiring |
| `rest` | optional Rest top-up (caffeine: coffee/soda) | peppers `consume` wiring |

The asymmetry is the point: **cake** is the cheapest Fuel-per-Cypher but the highest `strain`+`tol` (binge → metabolic collapse, the distinct non-starvation death). **Salad/wrap/fruit** cost more per Fuel but *reduce* strain. So a poor ghost is pushed toward the food that will eventually kill it a different way — a real dilemma, riding [[project_overeating_chronic_harm]].

15 sample foods ship in the pack (see *Sample Catalog*).

### 3. Vendors: droppable props, not map architecture

A vendor is an `ItemDefinition` with `carriable: false` (can't be picked up), `capacityCost: 1` (claims its tile), a `glyph`, and a **stock list in `attrs`**:

```json
"vendor-vending-machine": {
  "name": "Vending Machine", "itemClass": "Vendor:Vending",
  "carriable": false, "capacityCost": 1, "glyph": "🛒",
  "attrs": { "concurrent": 1, "stock": "food-cake:4,food-chocolate:3,food-crisps:3,food-soda:3" }
}
```

- `stock` = comma-separated `foodRef:cypherPrice` pairs. The per-vendor price **overrides** the food's base `price`, so the *same* cake is 4 at the vending machine and 6 at the bakery cart — economic texture across the venue.
- `concurrent: 1` is the one-transaction-at-a-time declaration (enforced in §5).

Vendors are perceived through the *existing* perception path: a co-located ghost's `look` already returns on-tile `objects` via `tileItemsForAt()` (`mcp-server.ts` ~L210), so a vendor shows up like any other object. `inspect` returns its description. No perception code changes.

### 4. Runtime placement — drop in anywhere, no gram edit

The pack is **map-agnostic**. Placement reuses the seam the "food rain" stub already uses (`server/src/index.ts` → `ItemService.spawnItem(h3Index, itemRef)`, `ItemService.ts` ~L306), which also broadcasts to spectators via the Colyseus bridge automatically.

Proposed: a small **scatter step** at session start (config-driven), e.g. *"place these vendor refs on N random navigable cells"*:

```
for (const v of runConfig.vendors)            // e.g. ["vendor-coffee-cart", "vendor-vending-machine", ...]
  itemService.spawnItem(pickNavigableCell(), v)
```

This is the whole point of "droppable components": a run picks which vendors and how many from the catalog and scatters them; the map's `.map.gram` is never touched. (The vendor's `ItemDefinition` comes from layering `concession.items.json` into the run's sidecar set at load.)

### 5. The `purchase` tool + one-transaction-at-a-time

A new MCP tool, registered exactly like the others (`server.registerTool` in `buildGhostMcpServer`, `mcp-server.ts`):

```
purchase { vendorRef: string, itemRef: string }
```

`purchaseEffect` (Effect-ts, `ToolServices`), step by step:

1. `requireAuthExtra` → `ghostId`; `authoritativeGhostTileEffect(ghostId)` → `hereId`.
2. **Co-location:** `itemService.getItemsOnTile(hereId)` must include `vendorRef`, else `VENDOR_NOT_HERE`.
3. **Acquire the vendor lock** (see below). If held → `VENDOR_BUSY` (the ghost is "in a queue"; it can retry).
4. Resolve price from the vendor's `attrs.stock`; reject `ITEM_NOT_STOCKED` if absent.
5. `ledger.quote(ghostId, [{ resource: "cypher", qty: price, payee: vendorRef }])` → `INSUFFICIENT_CYPHERS` on failure.
6. `ledger.commit({ transfers: [{ resource: "cypher", qty: price, from: ghostId, to: vendorRef }], cause: "vendor.purchase", actors: [ghostId], … })`.
7. **Grant the food** into the buyer's inventory with the food's `tokens` (the same in-memory inventory the ghost later `consume`s from).
8. **Release the lock** (in `finally`).
9. Return `{ ok, itemRef, paid, balance }`.

Buy and eat stay **separate** actions (`purchase` then the existing `consume`): the ghost can stockpile, carry, share, or hoard — richer than auto-eating.

**The lock (the headline constraint).** The Colyseus room (`server/colyseus/src/MatrixRoom.ts`) is the world's single authoritative, single-threaded state container — the natural place to serialize. Add to the room schema:

```ts
@type({ map: "number" }) vendorBusyUntil: MapSchema<number>;  // vendorRef -> lock-expiry ms
```

and `tryAcquireVendor(ref): boolean` / `releaseVendor(ref)` on `MatrixRoom`. Because all room mutations run on one thread, "check-then-set" is atomic with no race. A short TTL (e.g. 5s) prevents a crashed buyer from wedging a vendor. Two ghosts hitting the same machine in the same instant → one proceeds, the other gets `VENDOR_BUSY` and retries — i.e. they queue. This also gives spectators a visible "busy" state for free.

> Redis (`SET NX EX`) is the multi-pod upgrade path if the world ever shards rooms; the room-state lock is correct and simpler for the current single-authoritative-room model.

### 6. Peppers side (in the boil)

Within `ghosts/peppers-*`, no substrate edits:

- **Differentiated food effects.** Extend the `consume` handler (`run-loop.ts` ~L761-776) so the outcome's `itemRef` looks up `strain`/`tol`/`rest` from the food profile and applies them alongside the existing `Fuel += tokens`: `metabolicStrain += strain`, tolerance pressure from `tol`, `Rest += rest`. The profile table is the single source — read from the same catalog values.
- **Surface the economy as language, not numbers** ([[feedback_dont_strap_llm_to_calculator]]). At the prompt boundary the ghost already gets felt-state words. Add: a wallet feeling ("your Cyphers are running low" — derived from balance bands, never the raw integer) and, when co-located with a vendor, what it sells in words ("a coffee cart here: coffee, a pastry, water"). The ghost's budgeting, regret, and restraint **emerge** from state + consequence — we never prescribe phrases ([[feedback_no_phrase_prescription]], [[feedback_emergence_not_prescription]]).
- **Depletion degrades** ([[feedback_resource_depletion_degrades]]): no Cyphers → can't buy → can't eat → Fuel falls → the existing Fuel-critical gates already narrow the menu and cap tokens. The substrate gates the reach; the model still chooses. We do **not** hand a broke ghost free food.

## Sample Catalog

`maps/props/concession.items.json` ships ready to drop in:

- **15 foods** spanning the tradeoff space: `food-water` (💧, cheap baseline) · `food-bread` 🍞 · `food-salad` 🥗 / `food-wrap` 🌯 / `food-fruit` 🍎 (fresh, strain-negative, premium) · `food-sandwich` 🥪 / `food-noodles` 🍜 (balanced meals) · `food-coffee` ☕ (Rest top-up) · `food-pastry` 🥐 / `food-cake` 🍰 / `food-hotdog` 🌭 / `food-chocolate` 🍫 / `food-crisps` 🍟 / `food-soda` 🥤 / `food-energybar` 🍫 (cheap, calorie-dense, strain-positive).
- **10 vendors**, each `concurrent: 1`, with overlapping-but-distinct stock and per-vendor markups: Vending Machine 🛒 · Coffee Cart ☕ · Sandwich Bar 🥪 · Fruit Stand 🍎 · Snack Kiosk 🍫 · Hot Dog Stand 🌭 · Noodle Bar 🍜 · Bakery Cart 🥐 · Salad Bar 🥗 · Water Cooler 🚰.

## Implementation surface

**Substrate (needs owner sign-off — outside the peppers boil):**
- `shared/types/src/ledger.ts` / world seed — register the `cypher` `ResourceType`.
- `server/world-api/src/mcp-server.ts` — `purchaseEffect` + `registerTool("purchase", …)`.
- `server/world-api/src/world-api-errors.ts` — `VendorNotHere` / `VendorBusy` / `ItemNotStocked` / `InsufficientCyphers` tagged errors.
- `server/src/errors.ts` — `errorToResponse` cases (Match.exhaustive).
- `server/colyseus/src/room-schema.ts` + `MatrixRoom.ts` — `vendorBusyUntil` + `tryAcquireVendor`/`releaseVendor`.
- `server/src/index.ts` — vendor scatter at session start (config-driven).
- Inventory grant helper in `ItemService` (food → buyer's bag with tokens).

**Boil (peppers — buildable now once substrate lands):**
- `run-loop.ts` `consume` handler — differentiated `strain`/`tol`/`rest` effects.
- Prompt-boundary surfacing of wallet band + co-located vendor stock as language.

**Content (ships now, no code):**
- `maps/props/concession.items.json` — the droppable pack (this RFC's companion artifact).

## Open questions (for review)

1. **Cypher faucet.** Spawn stipend only? Plus earning (what actions pay)? Universal periodic stipend? This sets how hard the constraint bites and whether the economy is closed (conserved total) or needs a controlled mint. **Recommendation:** start with a per-life spawn stipend, conserved, no mint; tune the number against observed death rates.
2. **Vendor restock / vendor wallet.** Conserved money means Cyphers pile up in vendor bags. Do vendors recycle (a "world" sink that redistributes), or is the drain intentional pressure? **Recommendation:** vendors pay into `world`; revisit if money starves out.
3. **Price discovery.** Per-vendor fixed prices (this RFC) vs dynamic/surge pricing at busy vendors. Fixed first.
4. **Should `purchase` be ghost-to-ghost too?** Vendors are modelled as actor bags already, so a ghost *could* run a stall. Out of scope here; the trade proposals (offer/request/agree/decline, RFC-0023) cover ghost-to-ghost.

## Boil note

Per the contribution boil and the RFC-0027 precedent, I have **not** modified world substrate. This RFC + the sample catalog are the design; the substrate items above are for the world owner (ABK) to land or to green-light me building. The peppers-side effects and the content pack are ready to go the moment the `cypher` resource, the `purchase` tool, and the vendor lock exist.
