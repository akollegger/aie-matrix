# RFC-0034: Cosmic Elevators — birth-only, queued, distributed ghost spawn points

| Status | Draft — for @akollegger's consideration |
|--------|------------------------------------------|
| Date   | 2026-06-14 |
| Author | @henrardo (drafted with Claude during a reincarnation-mechanics session) |
| Related | [RFC-0019](0019-barnacle-protocol.md) (spawn/respawn ownership — `registry/spawn-ghost.ts`, `/respawn`), [RFC-0009](0009-map-format-pipeline.md) (gram tile types + rules), [RFC-0002](0002-rule-based-movement.md) (GO allow-list rules), [RFC-0006](0006-world-objects.md) (world items / tiles) |

## Summary

Introduce a **Cosmic Elevator**: a new tile type that is the *only* place ghosts are born, is **exit-only** (ghosts may step out, nothing may step in), and **queues** births so they release onto the map one at a time without piling up. Several elevators are placed per map and chosen at random per spawn, distributing births across the world. This replaces today's "pick a uniformly random cell from the whole map" spawn with an intentional, themeable birth mechanic — and along the way fixes two latent spawn/map bugs (ghosts spawning stranded in `Void`, and a Floor/Room movement partition).

Spawn placement is owned by ABK's spawn flow (`server/registry/src/routes/spawn-ghost.ts`, Barnacle Protocol). **This RFC proposes a change to that flow and defers the decision to its owner** — it is not implemented.

## Motivation

Today, `handleSpawnGhostEffect` places a new ghost like this:

```ts
const cellIds = [...map.cells.keys()];                  // EVERY cell in the map
const spawnCell = isEnvTruthy(AIE_MATRIX_TCK_MODE)
  ? map.anchorH3
  : cellIds[Math.floor(Math.random() * cellIds.length)]; // uniform random, no filter
bridge.setGhostCell(ghostId, spawnCell);
```

Three problems observed while running peppers ghosts on the Moscone West map:

1. **Ghosts spawn stranded in `Void`.** `map.cells` includes the `Void` "Offices" polygon (452 of 19,136 cells on Moscone West). `Void` carries no `GO` rule edges, so a ghost born there can never move — it enters `Void` and is stuck for life. ~2.4% of births on this map are dead-on-arrival. This is incidental (unfiltered random), not a designed "ghosts emerge from the Void" mechanic.
2. **Births pile onto occupied cells.** Uniform random has no occupancy awareness, so ghosts can spawn on top of each other; a clump of simultaneous spawns (e.g. a reincarnation wave) lands scattered but can collide.
3. **Floor and Room are a movement partition.** Moscone West's rules are only `(floor)-[:GO]->(floor), (room)-[:GO]->(room)` — there is no `floor↔room` edge, so a ghost born in a Room can never reach the Floor (or the Catering food), and vice-versa. A ghost's reachable world is decided at birth by which domain it randomly landed in. (Possibly intentional; flagging because it interacts with spawn distribution and foraging.)

A Cosmic Elevator addresses all three and gives birth a deliberate, narratable shape: ghosts arrive *somewhere specific*, step out into the world, and can never crowd back into the birth space.

## Design

### Tile type + rules (gram)

A new tile type, exit-only via the existing GO allow-list — grant outbound edges, author **no** inbound edge:

```gram
(elevator:TileType:CosmicElevator { name: "Cosmic Elevator", style: css`background: #1b1035` })

[elevators:Layer {kind: "tile", name: "Cosmic Elevators"} |
    (:Tile:CosmicElevator { geometry: [h3`…a`] }),
    (:Tile:CosmicElevator { geometry: [h3`…b`] }),
    …  // a few, spread across the map
]

[rules:Rules |
    (floor)-[:GO]->(floor), (room)-[:GO]->(room),
    (elevator)-[:GO]->(floor), (elevator)-[:GO]->(room)   // step OUT only — no edge INTO elevator
]
```

`evaluateGo` already enforces allow-list movement when rules are authored, so "no inbound edge → cannot enter" needs **zero new movement code** — exit-only falls out of the gram. (Verified against `movement.ts` / `goStepPermittedByRules`.)

### Placement (the spawn-flow change — ABK's call)

Replace the uniform-random pick in `handleSpawnGhostEffect` with elevator-based placement:

```ts
const elevators = [...map.cells.values()].filter(c => c.tileClass === "CosmicElevator");
// Visit elevators in random order; release at the first with a FREE, navigable adjacent cell.
for (const e of shuffle(elevators)) {
  const exit = Object.values(e.neighbors).find(nid => isNavigable(nid) && occupants(nid) === 0);
  if (exit) { place(exit); return; }   // distributed + no overlap
}
place(randomElevatorCell);             // all exits busy → wait IN the elevator (the queue)
```

- **Distribution**: several elevators + random selection spreads births across the map.
- **No overlap**: release only onto a free adjacent cell.
- **Queue**: when all exits are occupied, the ghost holds on the elevator cell (unbounded capacity) and leaves on a later tick once a neighbour frees, or via its own first `GO`. "Exit when it's your turn" emerges from "release only to a free cell."
- **No stranding**: elevator exits are filtered to navigable (non-`Void`) cells.

This wants a tiny world-side helper to drain the queue (or it drains naturally as ghosts take their first step). Reincarnation (a peppers-side mechanic, separate) already routes rebirths back through this same spawn flow, so it inherits elevators for free.

### Where elevators live

Single-cell explicit `:Tile` overrides at chosen, spread-out h3 indices (e.g. one near the Lobby, Expo stages, etc.), each with ≥1 navigable neighbour to exit onto.

## Open Questions

1. **Owner decision**: this changes `registry/spawn-ghost.ts` and the map — both ABK's domain. Should it land there, or stay a peppers-side convention?
2. **Queue draining**: rely on ghosts' own first `GO` to leave the elevator, or add a world tick that actively releases queued ghosts FIFO? (The former is simpler; the latter is more "fair".)
3. **Fix the two bugs regardless?** Even without elevators, should `spawn-ghost.ts` (a) exclude `Void`/non-navigable cells from the random pick, and (b) should Moscone West get `floor↔room` edges? These are independent of this RFC and arguably should be fixed now.
4. **TCK mode**: keep `map.anchorH3` for tests, or a designated test elevator?
5. **Capacity / visuals**: should the elevator render distinctly in Intermedium + the map editor (it does already, via the tile-type `style`)?

## Alternatives

- **Status quo (uniform random)** — simplest, but strands ghosts in `Void`, allows overlap, and has no narrative shape.
- **Filter random to navigable cells** — fixes stranding only; no distribution intent, no exit-only birth space, no queue. (Recommended as a minimal interim fix if elevators aren't adopted — see Open Question 3.)
- **Single fixed spawn point (e.g. the Lobby)** — one designated birth cell. Simple and themeable, but concentrates births (overlap/queue pressure at one spot) and offers no map-wide distribution.
- **Peppers-side placement** — peppers picks the cell at adopt/respawn time without touching the world. Rejected: exit-only can't be enforced (movement rules are world-side), elevators wouldn't be real tiles, and it would be a "mentioned but not enforced" half-measure.

## Notes for the reviewer

A working prototype of the gram + placement was built and then **reverted** to defer to the spawn-flow owner — so this RFC reflects something that has actually run, not just a sketch. The exit-only-via-gram and elevator-neighbour-exit placement both worked in local map-load tests; the only integration gap was that births flow through `registry/spawn-ghost.ts` (this RFC's target), not the `authoritativeGhostTileEffect` relocation fallback the prototype first touched.
