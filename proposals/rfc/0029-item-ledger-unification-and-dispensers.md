# RFC-0029: Item–Ledger Unification & the Dispenser (Vending) Actor

- **Status:** Draft (for review — touches ABK's substrate)
- **Author:** henrardo (peppers)
- **Date:** 2026-06-15
- **Affects:** `server/world-api` (ItemService, LedgerService, mcp-server, errors), `server/colyseus` (spectator broadcast), the map gram, **all consumers of `take`/`drop`/`consume`** (RDC, random-agent, spectator client). **Shared substrate — ABK's domain.**
- **Supersedes/executes:** RFC-0023 §8 (the deferred RFC-0006→ledger merge), RFC-0028 (the bespoke `VendingMachineService` is withdrawn in favour of this)
- **Related:** RFC-0006 (World Items), RFC-0023 (Resource Ledger)

## Summary

Execute the item→ledger unification that RFC-0023 already designed but deferred: **world items become conserved, quantity-1 ledger resources**; `take`/`drop`/`consume` become **ledger transfers**; and a **vending machine is a "dispenser" actor** with its own ledger bag — exactly as RFC-0023 §3 anticipates ("chests, dispensers — will be actors too, with their own bags"). With items in the ledger, **purchase is a plain `offer`/`agree` trade** (item-resource ↔ gold) — zero new transaction machinery. This retires the parallel `ItemService` and the bespoke `VendingMachineService` from RFC-0028.

The one question RFC-0023 left open and this RFC resolves: **stateful food**. RFC-0023 unifies only *stateless* items; food's per-instance `tokens` are stateful. Resolution: food becomes **stateless quantity-1** — one unit, one `consume`, a **fixed per-type Fuel value** (= its former `tokens`). The cake sugar-crash and all food differentiation (RFC-0028 follow-up, already built in `peppers-inner/food-effects.ts`) are keyed by `itemRef`, not the token pool, so they survive unchanged. Only *partial eating* is lost (you consume and share whole units).

## Motivation

The vending machine forced the question, but the answer is bigger than vending. Today there are **two parallel ownership systems**: the **ledger** (gold/xp/badge, bag balances, conserved/monotonic, hash-chained, verifiable) and **`ItemService`** (food/keys/etc. as in-memory tile + inventory lists with per-instance tokens). RFC-0023 §8 + the rejected-alternatives section are explicit that this duplication is interim: *"stateless items ARE conserved quantity-1 resources; unifying them removes a whole parallel ownership/persistence system."* Unifying:

- makes **purchase trivial** — it's an `offer`/`agree` trade, the least-machinery path the team keeps converging on;
- gives items the ledger's **conservation + provenance + verifiability** (an item can't be duplicated or vanish);
- collapses two systems into one;
- makes a **dispenser** (vending machine) just another actor — no special-casing.

## Design

### 1. Items as conserved quantity-1 resources

Each item *type* becomes a `ResourceType { class: "conserved", qty: <world count>, floor: 0 }`. The **ledger** owns count + ownership + location; the **item sidecar** keeps the descriptive/behavioural metadata (`name`, `glyph`, `itemClass`, `carriable`, and — new — `fuel` and the food-effect profile). Ownership is a bag holding; a tile location is an *attribute of the holding* (RFC-0023 §"Actors and bags"), carried on the transfer's existing `location?: {h3Index}` field.

### 2. take / drop / consume become ledger ops

- **take** = transfer `world → ghost` of one unit, clearing `location`. (Replaces `ItemService.takeItem`.)
- **drop** = transfer `ghost → world` of one unit, setting `location` = the ghost's cell. (Replaces `dropItem`; capacity check stays.)
- **consume** = transfer `ghost → world` (or burn) of one unit **and** apply the item's fixed `fuel` + food-effect profile. (Replaces `consumeItem`; the run-loop consume path in `peppers-agent-v2` rewires from `outcome.consumed` (token pool) to the item type's fixed `fuel`.)

Perception (`look`) reads located world holdings from the ledger instead of `ItemService.getItemsOnTile`. The Colyseus spectator broadcast (`tileItemRefs`) is fed from the same.

### 3. The dispenser (vending machine) actor

A vending machine is an **actor** (`machineId`) with a **ledger bag** = its stock (item-resources) and its takings (gold). It is placed on a cell (its `location`/cell recorded so co-located ghosts perceive it). It carries a **price list** (gold per item), declared in the map gram alongside the resource seed.

**Purchase = `offer`/`agree`, unchanged:**
1. The machine (a scripted fixture — RFC-0028 ruling) `propose`s a trade to a co-located ghost: `give = {item, 1}`, `want = {gold, price}`.
2. The ghost `agree`s (or `decline`s). `ProposalService.agree` already commits both transfers atomically: item `machine→ghost`, gold `ghost→machine`. **Done** — no new tool, no `pay` callback, no bespoke service.
3. The ghost `consume`s the item (now a ledger op).

**"One transaction at a time"** falls out for free: a proposal is a single pending object; the machine holds at most one open proposal per counterparty, and `agree` is an atomic ledger commit. (If we want a hard per-machine serialization, cap the machine to one *pending* proposal at a time — a one-line guard in the scripted fixture, not new substrate.)

> This is why RFC-0028's `VendingMachineService` is withdrawn: it was the "items as a separate system" that RFC-0023 explicitly rejects.

### 4. Stateful-food resolution

Food → **stateless quantity-1**. Each food type declares a fixed `fuel` (its former `tokens`). `consume` removes one unit and applies that `fuel` + the `itemRef`-keyed food-effect profile (immediate Rest/strain + the delayed gain-relative crash). **Kept:** the entire cake/differentiation mechanic (it never depended on the token pool). **Lost:** partial eating and token-preservation-through-carry; sharing is by transferring whole units (which the ledger does natively). Genuinely *stateful* items (a half-charged device) remain a future actor-layer concern, exactly as RFC-0023 says.

## Migration plan (reviewable steps)

1. **Sidecar + seed**: add `fuel` to the `ItemDefinition`; emit a `ResourceType` per item type from the map gram (`[resources]` gains item rows); seed gold on the live map.
2. **Ledger item ops**: add located-holding support to the ledger reads (bag entries with `location`); implement take/drop/consume as ledger transfers behind the *existing* MCP tool names (no tool surface change).
3. **Perception**: point `look`/spectator broadcast at the ledger's located holdings; delete `ItemService`.
4. **Consume rewire**: peppers run-loop consume → fixed `fuel` + food-effect profile (drop the `consumed`-token read).
5. **Dispenser**: vending machine as an actor + price list + scripted offer→agree; retire `VendingMachineService`.
6. **Consumers**: update RDC + random-agent + any take/drop/consume callers; verify the spectator client still renders items.

Each step keeps the system green; the tool surface (`take`/`drop`/`consume`/`offer`/`agree`) is unchanged for agents throughout.

## Blast radius / ownership

`take`/`drop`/`consume`/`ItemService`/`LedgerService` are **ABK's core substrate**, used by RDC, the random-agent, and the spectator client. This is not a peppers-boil change. Per "defer to ABK on his domains," this RFC is for **his review/sign-off** before steps 2–6 land, even though the end-state architecture is his own (RFC-0023). The peppers-side change (consume rewire, step 4) is the only part inside our boil.

## Alternatives (rejected)

- **Bespoke `purchase` tool + `VendingMachineService`** (RFC-0028 path): a parallel item system the team's own RFC-0023 rejects; more machinery than reusing `offer`/`agree`.
- **Wire physical money-on-tiles** (ledger `location` for gold): more machinery than a direct trade; the team chose direct ledger transfer.
- **Keep two systems, bridge per-purchase**: permanent duplication + a conversion layer; strictly more machinery.
