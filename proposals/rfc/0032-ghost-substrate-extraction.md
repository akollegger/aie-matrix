# RFC-0032: Ghost cognitive substrate extraction — PeppersGhost as the default ghost

> **Renumbered note (2026-06-02):** originally drafted as RFC-0021, renumbered
> after main shipped its own RFC-0021 (World Calendar). No content changes
> beyond this note and the renumbered cross-references.

| Status | draft — decision needed |
|--------|-------------------------|
| Date   | 2026-05-27 |
| Authors | @henrardo |
| Related | [RFC-0007](0007-agent-host-architecture.md) (agent-host shape), [RFC-0011](0011-ghost-personality-substructure.md) (slider model), [RFC-0017](0017-rdc-server-capability-gating.md) (capability gating — feeds the universal/platform tool split), [RFC-0019](0019-barnacle-protocol.md) (Barnacle — orthogonal; supersedable by RFC-0020), [RFC-0020](0020-platform-links.md) (Platform Links — transport-layer simplification; orthogonal to this cognitive-layer RFC) |

## Summary

Lift the ghost cognitive layer out of `peppers-agent` into a shared substrate (`peppers-inner`, expanded) so every house-specific ghost — RDC poker, future Roaring Twenties, future Harry Potter — inherits one canonical brain and supplies only **config + house-specific MCP tools** on top of it. PeppersGhost becomes the default ghost; "make a new house" is a tailoring exercise, not a reimplementation.

Today, `peppers-agent` and `rdc-poker-session` ship **parallel** cognitive implementations. The commitment ledger, intent-driven `say`, encounter brain, and the upcoming mechanical-slider machinery live only in peppers-agent; RDC reimplements equivalents in its own `poker-brain.ts`, `reflect-brain.ts`, `decision-pipeline.ts`. Every future house would have to write a third parallel brain. This RFC argues that's wrong now, will compound, and the fix is structural rather than incremental.

## Motivation

### The current state

`@aie-matrix/ghost-peppers-inner` is a small pure library: slider math, OCEAN facet set, drift adjustments, stimulus events. Everything *above* that — the Id pipeline, the Surface, the commitment ledger, intent-driven `say`, the encounter brain, the run-loop — lives in `@aie-matrix/ghost-peppers-agent`.

`@aie-matrix/ghost-rdc-poker-session` consumes `peppers-inner` for `PersonalityState` and `peppers-mem` for Neo4j persistence, but reimplements everything else: its own brain pipeline (`poker-brain.ts`, `reflect-brain.ts`, `decision-pipeline.ts`, `invite-decision.ts`), its own encounter brain (separate file, same name), its own table-runner and session-loop. The shared surface is the substrate model (OCEAN sliders, memory persistence); cognition is duplicated.

### Why this is debt

Three concrete consequences:

1. **Improvements to peppers don't reach RDC.** The commitment ledger and intent-driven `say` we shipped in the last PR are absent from RDC's brain. RDC's "table talk" is its own mechanism. When the next phase of work — mechanical slider→behaviour pipes (numeric sliders driving real game-state via dice rolls, the way `tilt-detector.ts` already does) and decaying-needs (a `play`/`social`/`solitude` need system feeding the impulse layer) — lands, it'd have to ship twice.
2. **A new house is "build from scratch."** A contributor wanting a Harry Potter wizards' duel today would clone-and-modify rdc-poker-session as the closest example, then maintain a third parallel brain forever. The promise of "inherit the substrate, supply config" doesn't exist to inherit from.
3. **The four-pillar peppers-base upgrade has no home.** Genuine needs, desires, emergent behaviour, free-will substrate — these should be properties of *every* ghost in *every* house. If they ship in peppers-agent only, RDC's poker players don't have needs and can't develop emergent personalities; the lizard brain is mute the moment a ghost sits at a table.

### Why now, before mechanical sliders

The next phase of work — mechanical pipes, decaying needs, the longer arc toward genuine desires and emergent personality — adds significant new cognitive machinery. Putting any of it into `peppers-agent` first locks the parallel-implementation pattern deeper. Substrate extraction is genuinely a prerequisite, not a parallel concern.

A further future vision — a meta-house whose ghosts try to convince ghosts of other houses that their reality is a simulation — depends on belief substrate being consistent across houses. Without a shared substrate, "freeing" a ghost has no defined surface to act on. This RFC is the foundation that vision sits on; the vision itself is out of scope here.

### AIEWF 2026 framing

The RFC's "third-party contributor" examples (Harry Potter, Roaring Twenties) are forward-looking. Per `docs/architecture.md`, AIEWF 2026 ships with **first-party ghosts only**; the third-party remote-endpoint contribution model is deferred. The substrate's value during that window is internal: RDC and any future first-party house need the same inheritance the third-party model later will. This is not premature optimisation for absent contributors — it's eliminating the parallel-brain tax that we are paying right now.

## Design

### The four organs

A PeppersGhost has four organs:

| Organ | Responsibility | Today | Target |
|---|---|---|---|
| **Heart** | OCEAN sliders + drift mechanics + persona expression | `peppers-inner` | unchanged — already correctly placed |
| **Head** | Id pipeline (impulse → convergence → synthesis → commitment), Surface (action selection from MCP tool list), intent-driven `say`, encounter brain | `peppers-agent` | move to `peppers-inner` (or `ghost-mind`; see §Naming) |
| **Hands** | MCP tool calls — world verbs | `server/world-api` | unchanged location; introduce **universal vs platform-gated** split (see §MCP Tool Split) |
| **Lizard brain** | Decaying needs (`play` / `social` / `solitude`) feeding the impulse layer | doesn't exist yet | new module in the substrate, lands in this RFC's wake |

### Substrate API

The substrate exposes a configured-ghost factory:

```ts
import { makePeppersGhost, type GhostConfig } from "@aie-matrix/ghost-peppers-inner";

const ghost = makePeppersGhost({
  // Heart
  sliderDefaults: { /* per-facet overrides; missing facets use library defaults */ },
  driftRates: { /* per-facet drift speed */ },

  // Head
  intents: ["greet", "propose", "decline", "depart", /* ... */],
  prompts: {
    idSystemFragment: "...",        // appended to library default
    surfaceSystemFragment: "...",
    monologueStyle: "...",
  },
  objective: "default objective text",

  // Hands — declared, gated at runtime by world capability checks
  tools: {
    universal: ["say", "go", "look", "inspect", "enter-mini-game", /* ... */],
    platformGated: ["play-poker", /* per-tile-class verbs */],
  },

  // Lizard brain.
  // `satisfiedBy` is a list of cascade-event predicates (NOT MCP tool names) —
  // exact shape TBD as part of phase 2. Strawman semantics: a predicate
  // matches a cascade if the listed event was observed during it.
  needs: [
    { name: "play",     decayPerCascade: /* TBD; tunable per house */, satisfiedBy: [{ event: "entered-platform" }] },
    { name: "social",   decayPerCascade: /* TBD */, satisfiedBy: [{ event: "said-with-reply" }] },
    { name: "solitude", decayPerCascade: /* TBD */, satisfiedBy: [{ event: "cascade-ended-without-conversation" }] },
  ],

  // Per-house extensions registered as plugins, not parallel implementations
  brainPlugins: [
    /* { name: "poker-school-rules", phase: "post-impulse", run: (ctx) => ... } */
  ],
});
```

**Surface's input contract is preserved across houses**: `{ worldContext, toolMenu, objective, monologue } → { action, tool, args }`. Its prompt is split into a library-fixed scaffold (which guarantees the LLM is choosing from `toolMenu`, not hallucinating verbs) plus the per-house `surfaceSystemFragment` shown in the config above. Houses tune voice and emphasis; the scaffold enforces the contract.

The substrate consumes this config and exposes the same `runHouse`-shaped entry point that today lives in peppers-agent. House-specific packages (`peppers-agent`, `rdc-poker-session`, future `hp-agent`) become **thin orchestrators** that:

1. Build a `GhostConfig` literal.
2. Register house-specific brain plugins (e.g. RDC's equity-oracle, school rules, animal bias, tilt detector — all just plugin functions called at named pipeline phases).
3. Hand the config to `makePeppersGhost()`.
4. Provide their A2A surface (spawn, encounter, pause/resume, plus house-specific endpoints like RDC's session handoff).

### MCP tool split: universal vs platform-gated

Today, `server/world-api/src/mcp-server.ts` exposes a single tool list. This RFC introduces an explicit two-tier classification:

- **Universal tools** — `say`, `go`, `look`, `inspect`, `inventory`, `whereami`, `exits`, `take`, `drop`, `nearest`, `whoami`, `inbox`, `bye`, `request_intent`, `enter-mini-game`. Available to every ghost regardless of house, with the existing capability gating that already handles "can I see this from here" semantics.
- **Platform-gated tools** — tied to standing on a specific platform tile class. `play-poker` only works when on a `PokerTable`. `cast-spell` only on a `DuelingGround`. The platform tile declares which tools it exposes; the world-api gates accordingly. RFC-0017 already provides the gating shape; this RFC formalises the universal/platform split.

The split matters because `enter-mini-game` is the only "transition" verb and is universal — entering a poker table or a wizards' duel is the same primitive at the substrate level. What changes is *which* mini-game platform is at this tile, and that's a property of the world map, not of the ghost's brain.

### Refactoring RDC poker-session — proof of substrate

The migration that proves the substrate is reusable, not just renamed:

| File today | Disposition under this RFC |
|---|---|
| `poker-brain.ts`, `reflect-brain.ts`, `decision-pipeline.ts`, `invite-decision.ts` | **Collapse.** Logic becomes brain plugins registered at named pipeline phases; the orchestration disappears (substrate runs the pipeline) |
| `school-rules.ts`, `animal-bias.ts`, `bluff-sampler.ts`, `tilt-detector.ts`, `equity-oracle.ts`, `candidate-generator.ts` | **Keep — they're genuinely poker-specific.** Wrap as brain plugins or config |
| `peppers-agent/encounter-brain.ts` (platform-encounter accept/decline) | **Lifts to substrate** as `encounterHook` primitive — every house gets accept/decline decisioning for free |
| `rdc-poker-session/encounter-brain.ts` (per-seat invite decisioning) | **Plugin** registered on the substrate's `encounterHook` to add poker-specific invite logic |
| `session-loop.ts`, `table-runner.ts` | Keep — this is the poker game loop, runs *alongside* the substrate's cascade rather than inside it |
| `agent.ts`, `executor.ts` | Slim down — become A2A surface + config assembly |
| `prompts.ts`, `persona-from-sliders.ts`, `hellmuth-profile.ts` | Move slider→persona mapping into config; prompts become config fragments |

Expected line-count delta: RDC shrinks substantially; the substrate grows; the *sum* shrinks because duplicated cognition collapses.

### Relationship to RFC-0019 (Barnacle)

The Barnacle Protocol says mini-games are **plugin-untrusted**: separate process, host-supervised, host respawns the ghost on crash. This RFC introduces **shared cognition by inheritance**. The two are not in conflict, but the seam needs naming:

- A Barnacle mini-game is still its own process. The protocol stays as-is.
- The substrate is a *library*, not a runtime. RDC poker-session links against it; a hypothetical Python-language mini-game does not.
- For non-JS Barnacle implementations, the substrate provides a **reference shape** (config schema + pipeline phase names) that the contributor reimplements in their language — or the contributor accepts that their mini-game has its own brain and only inherits via configuration sent over the Barnacle handoff bundle.
- JS-language Barnacle implementations (RDC, and probably most contributors) get to inherit. Non-JS ones get a documented contract.

This RFC therefore does **not** weaken Barnacle's isolation guarantee. It enriches the JS-path with substrate inheritance and documents the cross-language path as "reimplement against the schema."

### Migration plan

This is RFC-scoped, not implementation-scoped — concrete plan emerges from review — but rough phases:

1. **Phase 0 — Schema RFC.** This document. Decide naming, config shape, plugin phase contract.
2. **Phase 1 — Lift cognition.** Move Id pipeline, Surface, commitment ledger, intent-driven `say`, encounter brain from `peppers-agent` to `peppers-inner` (or new package — see §Naming). Add config plumbing. `peppers-agent` thins to a default-config wrapper.
3. **Phase 2 — Lizard brain.** Add needs module to substrate. Hook into impulse layer.
4. **Phase 3 — Mechanical sliders.** Implement slider→behaviour pipes (the `tilt-detector.ts` pattern, generalised: numeric sliders → dice-roll inputs → real cognitive-state mutation) inside the substrate, where every house inherits them.
5. **Phase 4 — RDC refactor.** Migrate `rdc-poker-session` onto substrate. Plugins replace its parallel brain. End-state: RDC's poker mechanics live as plugins, its cognition is inherited.
6. **Phase 5 — `create-house` template.** Scaffold script + LLM workflow that generates a `GhostConfig` + tool stubs for a new themed house.

Phases 1 and 4 are the load-bearing ones. 2–3–5 are downstream improvements that the architecture makes possible.

## Acceptance

This RFC's intent is delivered when all of the following are true:

1. **Peppers still works end-to-end.** `pnpm run dev` + `pnpm run demo` produces social cascade, encounter, conversation, and commitment-ledger behaviour observably identical to pre-extraction. No regressions in the existing peppers test suite.
2. **RDC poker runs against the substrate.** `RDC_GHOSTS=4 pnpm run rdc:demo` produces poker play where the substrate's pipeline logs show RDC plugins (school-rules, animal-bias, tilt-detector) being invoked at named phases. RDC's pre-extraction parallel-brain files (`poker-brain.ts`, `reflect-brain.ts`, `decision-pipeline.ts`, `invite-decision.ts`) are gone or thinned to plugin wrappers.
3. **A skeleton third-party house starts and behaves like a peppers ghost.** A minimal `ghosts/example-house/` package — ~50 lines of `GhostConfig`, zero brain plugins — produces a working ghost that walks the freeplay map, says hello, accepts encounters. This is the load-bearing proof: if it works, the substrate is genuinely inheritable; if it doesn't, the substrate is still peppers-specific in disguise.

## Demo

After phase 4 lands, a new contributor:

1. Clones the repo, runs `pnpm install`.
2. Runs `pnpm --filter @aie-matrix/ghost-example-house run dev` alongside `pnpm run dev`.
3. Within 15 minutes of clone, observes an example-house ghost walking the freeplay map and behaving like a peppers ghost.
4. Edits one slider default (e.g. `extraversion: 0.2 → 0.9`) in `example-house/config.ts`, restarts, observes behaviour-level differences in the next cascade.

If step 3 takes more than 15 minutes or step 4 requires changes outside `config.ts`, the substrate has leaked too much peppers-specific assumption and is not yet inheritable.

## Open Questions

1. **Naming.** PeppersGhost as the generic-ghost name conflicts with `peppers` being the canonical default-config wrapper. Two options:
   - **(a)** Keep `peppers-inner` as the substrate package; `peppers-agent` is the default-config impl. New houses are siblings (`rdc-agent`, `hp-agent`), not specialisations of peppers-agent. The "PeppersGhost is the default ghost" framing is conceptual, not literal package naming.
   - **(b)** Rename `peppers-inner` → `ghost-mind` (or `ghost-substrate`). Frees the `peppers-*` namespace to be unambiguously about the default-config implementation.
   
   (a) is less churn; (b) is cleaner long-term. Defer the decision until phase 1 begins.

2. **Plugin contract — phases.** What named phases does the brain pipeline expose for plugins to hook? Strawman: `pre-impulse`, `post-impulse`, `pre-convergence`, `post-synthesis`, `pre-action`, `post-action`. Risk: too many phases turn plugins into an internal-API maintenance burden. Right number to be argued in review.

3. **Plugin contract — composition order.** When multiple plugins register at the same phase (e.g. RDC registers school-rules AND tilt-detector at `pre-action`), how is order determined? Declaration order? Explicit `before` / `after` deps? Priority numbers?

4. **Config schema — versioning.** When a contributor's house declares `intents: ["cast-spell"]`, the substrate has no opinion. But if the substrate's config schema evolves (e.g. adds a required `culture` field in v2), existing house configs would break. Version the schema explicitly? Tolerate missing fields with defaults?

5. **Barnacle handoff bundle — config inheritance.** Today the Barnacle handoff sends OCEAN sliders. Should it also send the social-self's `GhostConfig`? If yes, the in-game ghost's config is the persistent ghost's config + house overlay. If no, the mini-game declares its own config independently. The richer answer enables continuity (a high-aggression peppers ghost is also a high-aggression poker player); the simpler answer keeps Barnacle's contract narrow.

6. **The "single LLM call to make a house" workflow.** Out of scope for this RFC, but the substrate's config schema is the input the LLM workflow would generate. Worth keeping the schema human-writable so the workflow's output is reviewable rather than opaque.

## Alternatives

1. **Don't extract — keep parallel implementations.** Cheap today, expensive forever. Every future house pays the same parallel-brain tax. Mechanical sliders, needs, Matrix-house belief mechanics all ship multiple times. Rejected because the per-house cost compounds.

2. **Extract only the new work, leave existing parallels in place.** Ship mechanical sliders only in `peppers-inner`; have RDC's existing brain ignore them. Survives the immediate decision but creates a permanent two-tier "default-substrate ghost" vs "RDC ghost" distinction. Houses written after the extraction inherit; RDC stays special forever. Rejected because it ratifies the parallel implementation as canonical.

3. **Lift via inheritance / class hierarchy** rather than config + plugins. Have `PeppersAgent` as a class, `RdcPokerAgent extends PeppersAgent` overriding hooks. Familiar from OOP but fights the existing functional/Effect-ts style of the codebase and complicates polyglot contributions (a Python Barnacle can't `extends` a TypeScript class). Rejected — config + plugins is the same expressive power without coupling to a language's class system.

4. **Move only the data model (`PersonalityState`, `intents` enum) and leave cognition split.** Slim refactor; documents the substrate at a data level. Doesn't solve the parallel-cognition problem; mechanical sliders still need to ship twice. Insufficient.

5. **Decompose `peppers-agent` into smaller packages without a config layer.** Split into `peppers-id-pipeline`, `peppers-surface`, `peppers-encounter`, etc.; RDC imports the bits it wants directly. Avoids defining a plugin contract. Rejected because it doesn't solve the *runtime composition* problem — RDC still has to wire its own pipeline order, and the upcoming mechanical-slider machinery still has no canonical home that every house automatically benefits from. Config + plugins is composition-by-data; library-of-functions is composition-by-code, and code composition is what we're trying to stop duplicating across houses.
