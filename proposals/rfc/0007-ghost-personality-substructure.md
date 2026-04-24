# RFC-0007: Ghost Personality Substructure

**Status:** draft  
**Date:** 2026-04-24  
**Authors:** @henrardo  
**Related:** [Architecture](../../docs/architecture.md) (claims the "Agent Framework" open question), [RFC-0005](0005-ghost-conversation-model.md) (conversation stimuli), [RFC-0006](0006-world-objects.md) (McGuffin substrate), [ADR-0001](../adr/0001-mcp-ghost-wire-protocol.md), [ADR-0002](../adr/0002-adopt-effect-ts.md), [ADR-0003](../adr/0003-conversation-server.md)

## Summary

Each ghost is composed of two cooperating sub-agents: a **Surface** that acts in the world via MCP, and a reflective **Id** that interprets every event, writes a first-person inner monologue the Surface reads as its own stream of consciousness, adjusts a set of two-dimensional emotional sliders, and distills narrative memory over time. The architecture is designed for N≥2 (future sub-agents — time-awareness, narrative-identity, planning — plug in via the same event substrate). All memory lives in a dedicated ghost-minds Neo4j instance: an event-granular substrate via the Neo4j Agent Memory package, and a Karpathy-style wiki for distilled self-narrative via Tomasonjo's Aura Agents Management MCP. Sub-agents are hosted as Neo4j Aura Agents (small models). No server, Colyseus, or world-API MCP changes are required — this is a purely agent-layer contribution that can be adopted as an RFC only, as a library only, as a complete ghost house, or not at all.

## Motivation

[docs/architecture.md](../../docs/architecture.md#open-questions) names **Agent Framework** as the largest under-claimed open question in the project: what framework, if any, do ghosts use for goal decomposition, planning, execution, and the surfacing of checkpoints? The current reference ghost ([`ghosts/random-house`](../../ghosts/random-house/src/index.ts)) is a random walker with canned conversational lines — sufficient to validate the MCP surface, not sufficient to populate a live conference experience with ghosts that feel like anyone's digital twin.

Two things are missing today, and this RFC addresses both.

**An inner life that drifts.** Ghosts need personality that evolves in response to experience rather than being scripted. A ghost that joins a conversation, is dismissed, and tries again differently is more useful — as a demo, as an attendee companion, and as a research surface — than one that samples from fixed behavior tables. Drifting personality also gives attendees an organic reason to check on their ghost: *what has it become?*

**A contribution surface that is modular on purpose.** The user building this ([@henrardo](https://github.com/henrardo)) is contributing as a friend, not as a vendor claiming a product slot. The design has to let the project lead adopt any one of {RFC only, library only, complete ghost house} without forcing the others. That constraint is a feature, not a compromise: it also means other houses — vendor-contributed or community — can reuse the inner-world library with their own surface behavior.

The mechanic itself is pilfered rather than invented: two-axis trait sliders are a Sims-adjacent pattern, OCEAN facets give us a grounded decomposition, and the Id/Surface split is an actor-critic shape. None of those traditions is load-bearing in the spec — they are source material for a mechanism, cited once in acknowledgments.

## Design

### Scope and non-goals

**In scope:**

- Per-ghost Surface + Id composition, extensible to N sub-agents.
- Two-dimensional (Internal, External) slider model with axis-neutral naming.
- Event-granular context graph recording every stimulus, action, thought, and adjustment.
- Two-layer memory: Neo4j Agent Memory event substrate plus Karpathy-wiki distilled narrative.
- Aura Agents hosting for Id and Surface via the Aura Agents Management MCP.
- McGuffin stand-in goal system, piggybacking on [RFC-0006](0006-world-objects.md) world items.
- Reference ghost-house package that runs ghosts with this architecture.

**Not in scope (deferred to future RFCs):**

- Sims-style needs-with-decay model. This RFC is trait-based; a sibling needs-based sub-agent is explicitly planned.
- Time-awareness sub-agent (ghost's sense of its own lifespan, conference schedule, deadline pressure). The Id is time-blind in v1.
- Promotion of narrative-identity from wiki seed to a standalone sub-agent with its own reasoning loop.
- Concrete goal system beyond the McGuffin stand-in; pending @akollegger.
- User-conversation-driven personality seeding at ghost birth (reserved hook).
- Generalization of the composition pattern past two fixed sub-agents.
- Any change to `server/`, Colyseus state, or the world-API MCP tool surface.

### Two-agent composition

Each adopted ghost is represented by two sub-agents hosted as Aura Agents:

- **Surface** — world-facing. Consumes a first-person inner-monologue fragment followed by the raw stimulus; emits a single MCP tool call (`say`, `go`, `take`, `drop`, `inspect`, `inventory`, `look`, `exits`, `whoami`, `whereami`, `bye`). The Surface is **slider-blind**: no slider names, numeric values, or mechanics appear in its prompt, ever.
- **Id** — reflective. Consumes the ghost's event substrate (via GraphRAG) plus relevant wiki pages plus current slider state; emits (a) an inner-monologue fragment for the Surface, (b) at least one up and one down slider adjustment, and (c) optionally a wiki write. The Id is **time-blind** in v1 — no awareness of conference schedule, ghost age, or external clock.

From the Surface's point of view, the Id and Surface are the same self; the Id is not an orchestrator giving the Surface instructions, it is the unconscious mental substrate that produces the felt experience the Surface inhabits.

The framework is explicitly designed for N≥2. A later RFC may add a **time-awareness** sub-agent that feeds the Surface a sense of remaining lifespan, a **narrative-identity** sub-agent that curates the wiki, or a **planner** sub-agent that proposes multi-step goal decompositions. Each plugs into the same event substrate without modifying Id or Surface contracts.

### Event-granular context graph

Every input, output, and reasoning step the ghost produces is recorded as a first-class event node on a single timeline. There is no split between "external log" and "internal log"; the causal tree is complete.

Event types:

| Type | Source | Written by |
|---|---|---|
| `EXTERNAL_STIMULUS` | Other-ghost utterance, cluster entry/exit, McGuffin state change within view, Surface-initiated action's observed result | Ghost house (inbound) |
| `SURFACE_ACTION` | MCP tool call emitted by the Surface | Ghost house (outbound) |
| `ID_THOUGHT` | Inner-monologue fragment or further internal reflection | Id |
| `ID_ADJUSTMENT` | Slider change, with before/after values and axis/direction | Id |

Each event is both an effect of prior events and a potential cause of future ones. The Id's introspection into its own prior thought ("rolling record of state of mind") is a Cypher traversal over the same substrate, not a separate summary buffer.

#### Reflection cascade and budget

An `EXTERNAL_STIMULUS` or `SURFACE_ACTION` event kicks off a bounded reflection cascade. The Id can chain further `ID_THOUGHT` and `ID_ADJUSTMENT` events before the cascade closes. Bounding is essential because `ID_THOUGHT` and `ID_ADJUSTMENT` are themselves events that, taken without limits, would recursively trigger more reassessment.

The reflection budget for a given stimulus is derived from the ghost's current slider state plus a hard ceiling:

```
budget.depth   = f(Deliberation.internal, Stability.internal) + base_depth
budget.tokens  = ghost_config.token_cap_per_cascade
budget.wallMs  = ghost_config.wall_cap_per_cascade
hard_ceiling   = configured_per_ghost          // prevents pathological spirals
```

Effective budget = `min(derived, hard_ceiling)`. High Deliberation + low Stability enlarges the cascade (the ghost ruminates); low Deliberation collapses the cascade to the minimum (the ghost snaps to action). This is the self-referential loop: the internal world is itself a variable that shapes how much internal world there is.

#### Interaction loop (pseudocode)

```
on_event(e):
  if e.type in (EXTERNAL_STIMULUS, SURFACE_ACTION):
    trace = memory.start_reasoning_trace(task=e.id)

    # 1. Id composes inner monologue
    context  = memory.graphrag(semantic_k=K, graph_depth=D, anchor=e)
    pages    = wiki.search_memory(relevant_to=e.payload)
    monologue = id.compose_monologue(context, pages, sliders, stimulus=e)
    memory.record_step(trace, type=ID_THOUGHT, content=monologue)

    # 2. Optional further thoughts, bounded
    budget = derive_budget(sliders, ghost_config)
    while budget.has_room() and id.wants_more_thought(trace):
      thought = id.further_reflect(trace, sliders)
      memory.record_step(trace, type=ID_THOUGHT, content=thought)
      budget.spend(cost(thought))

    # 3. Surface acts on monologue + stimulus
    if e.type == EXTERNAL_STIMULUS:
      tool_call = surface.decide(prepend(monologue, e.payload))
      result    = mcp.call(tool_call)
      memory.record_step(trace, type=SURFACE_ACTION,
                         action=tool_call, observation=result)

    # 4. Id critiques and adjusts sliders (≥1 up AND ≥1 down)
    critique    = id.critique(trace, sliders, mcguffin_relationship)
    adjustments = id.select_adjustments(
                    critique, up_budget=2, down_budget=2,
                    require_at_least_one_each_direction=True)
    for (trait, axis, direction) in adjustments:
      before, after = apply_logit_delta(sliders, trait, axis, direction)
      memory.record_step(trace, type=ID_ADJUSTMENT,
                         trait=trait, axis=axis, direction=direction,
                         before=before, after=after)

    # 5. Optionally distill narrative to wiki
    if critique.worth_remembering_as_identity:
      wiki.append_memory(path=critique.page, content=critique.distilled)

    memory.complete_trace(trace)
```

### Slider model

Each emotional trait carries **two parallel sliders**: `Internal` and `External`. The pair defines the ghost's coherence on that trait at that moment.

**Axis-neutral naming.** Slider names describe the axis, not a pole. 5,5 on any trait is the ataraxic midpoint — neither good nor bad, just extant. Names are editable; the rule is the point.

**Balance semantics.** Any (N, N) — Internal and External equal — is a coherent, livable personality at level N. 5,5 is ordinary balance; 10,10 is integrated high-trait expression; 1,1 is integrated low-trait expression. Dysfunction lives in the imbalances.

Canonical examples on the **Stability** trait:

| (Internal, External) | Expression |
|---|---|
| 5, 5 | Ordinary steadiness. Reacts proportionately to what life brings. |
| 10, 10 | Integrated serenity. Feels calm, projects calm, is calm. |
| 1, 1 | Integrated chaos. The charming hippie, the manic pixie dream girl. Volatile and authentic about it. |
| 10, 1 | Felt-stable, expressed-volatile. Outward mania, dissociation — the ghost destroying the deli counter while genuinely feeling fine. |
| 1, 10 | Felt-volatile, expressed-stable. Walter White early season; Kirk Douglas in *Falling Down*. Mild-mannered, one bad day from snapping. |

The Id's job is two-dimensional: manage absolute *level* per slider, and manage *tension* between Internal and External per trait. Authentic moments reduce tension; masking or performing creates it.

#### Storage and diminishing returns

Displayed values range over `[0, 10]`. Internally, each slider is stored in **logit space** (unbounded real):

```
value_logit   = logit(value_display / 10)
value_display = sigmoid(value_logit) * 10
```

Each adjustment is a fixed `±δ` in logit space (default `δ = 0.5`, per-ghost configurable). The sigmoid display produces natural diminishing returns without arbitrary clamping functions:

| Before display | Operation | After display | Δ |
|---|---|---|---|
| 5.0 | +δ | ~6.22 | +1.22 |
| 8.0 | +δ | ~8.69 | +0.69 |
| 9.5 | +δ | ~9.69 | +0.19 |

Sliders never reach 0 or 10; they asymptote. Adjustments never fail due to saturation.

#### Adjustment rule

Per interaction, the Id **must** move at least one slider up and at least one slider down. This prevents degenerate drift into "everything high" or "everything low" personalities.

Separate budgets govern how much further the Id may go:

```
up_budget   = ghost_config.up_budget    // default 2
down_budget = ghost_config.down_budget  // default 2
```

The Id selects fewer than the budget when fewer adjustments are warranted, but may never emit zero up-adjustments or zero down-adjustments. The Id's reasoning surface is **which** sliders to touch and **which direction** (binary). Magnitudes are fixed.

#### Starter active set (v1)

Eight facets are active for v1 testing, each with (Internal, External):

- **Ideas** — intellectual curiosity / ideational fluency
- **Deliberation** — reflective care before action
- **Assertiveness** — willingness to assert one's view
- **Warmth** — affective approachability
- **Trust** — default disposition toward others' good faith
- **Altruism** — willingness to act on others' behalf
- **Stability** — emotional steadiness under stress
- **Self-Monitoring** — attention to one's own social presentation

#### Full expansion target

The full active set is ~30 facets drawn from the NEO-PI-R decomposition of the OCEAN dimensions. Neuroticism facets are renamed to axis-neutral form (the rule: +1 on any slider always moves in the same vector direction). Indicative flips:

| Raw NEO-PI-R facet | Axis-neutral rename |
|---|---|
| Anxiety | Stability |
| Angry-Hostility | Even-Temperedness |
| Depression | Mood |
| Self-Consciousness | Self-Monitoring |
| Impulsiveness | Restraint |
| Vulnerability | Resilience |

Remaining OCEAN facets (Openness, Conscientiousness, Extraversion, Agreeableness) keep their NEO-PI-R names.

#### Starting values

At birth, each (Internal, External) pair is sampled independently from a truncated distribution around the midpoint — independently per facet. This yields distinct birth personalities from the same ghost-house configuration. A `personality_seed` parameter makes sampling reproducible per ghost.

Future extension (reserved hook, not implemented in this RFC): user-conversation-driven personality seeding, where the caretaker speaks with their ghost at adoption time and the resulting conversation is used to weight the initial slider distribution.

### Inner-monologue contract

The inner monologue is the **only** thing the Surface consumes beyond the raw stimulus itself. It is written in the **first person**, in natural language, with **zero** slider exposure:

- No trait names appear in the monologue.
- No numeric values appear.
- No references to "sliders," "adjustments," "Id," or any mechanism.
- The monologue reads as the ghost's own felt experience — stream of consciousness, not a report.

The Id composes the monologue using:

1. A GraphRAG query over the event substrate (semantic retrieval + graph traversal anchored at the current stimulus).
2. A wiki lookup for pages relevant to the stimulus (e.g., `relationships/ghost_42.md` when ghost_42 is speaking).
3. Current slider state, translated into felt experience internally by the Id.

Example of what the Surface receives for an incoming utterance:

```
Tonight has felt tight. Something in me is leaning back, tighter
than I'd like to admit — I want to be generous but a smaller voice
is telling me to guard what's mine.

ghost_42 says: "Hey — want to go check out the kiosk together?"

It lands warm but I don't quite trust it. Part of me wants to say
yes; part of me is already drafting a reason to peel off.
```

No "Trust: (3.2, 6.8)" anywhere. The Id has translated.

### Two-layer memory

Both layers live in the same dedicated ghost-minds Neo4j instance (an Aura DB or local Neo4j, infra-configurable). In v1 a shared instance with the world graph is acceptable; production deployments will use a dedicated instance to isolate event-write throughput.

#### Bottom: event substrate (Neo4j Agent Memory)

Uses the [`neo4j/labs/agent-memory`](https://neo4j.com/labs/agent-memory/) package **as is**; no custom implementation is introduced. The package provides:

- **Short-Term Memory** — sessions and messages. Every `EXTERNAL_STIMULUS` and `SURFACE_ACTION` is stored as a `Message` in the ghost's session.
- **Long-Term Memory** — POLE+O entities (Person, Object, Location, Event, Organization) with relationships. Our mapping:
  - `Ghost` → `Person`
  - `McGuffin` → `Object`
  - `Tile` → `Location`
  - `Interaction` → `Event`
  - `GhostHouse` → `Organization`
- **Reasoning Memory** — `(ReasoningTrace)-[:HAS_STEP]->(ReasoningStep)` chains capture the causal tree. `ToolCall` nodes link to `ReasoningStep` nodes via `:USED_TOOL`.

Ghost-specific specializations extend `ReasoningStep` with typed labels for the four event types above (`ID_THOUGHT`, `ID_ADJUSTMENT`, etc.). Slider state is captured as lightweight specialized nodes:

```
(:SliderSnapshot { ghostId, capturedAt, version })
  -[:HAS_VALUE]-> (:SliderValue { trait, axis, logit, display })

(:ReasoningStep:ID_ADJUSTMENT
  { trait, axis, direction, beforeDisplay, afterDisplay, appliedAt })
```

All queries, writes, and GraphRAG retrieval use the Agent Memory package's `MemoryClient` API. No custom Cypher bypass is introduced in v1.

#### Top: distilled narrative (Karpathy wiki via Aura Agents MCP)

Uses [`tomasonjo/aura-agents-management-mcp`](https://github.com/tomasonjo/aura-agents-management-mcp) **as is**. The MCP server exposes memory tools that treat the distilled narrative as a filesystem of markdown pages stored as `(Page { path, content, created_at, updated_at, wiki, deleted })` nodes connected by `LINKS_TO` self-edges.

Relevant tools (used by the Id, never by the Surface):

- `write_memory` — create or overwrite a page.
- `append_memory` — add to an existing page; synchronizes `[[wikilinks]]` as `LINKS_TO` edges.
- `read_memory`, `list_memories`, `search_memory`, `find_memory_backlinks` — retrieval.
- `rename_memory`, `delete_memory` — curation.

Recommended per-ghost page layout:

```
self/tendencies.md              # the ghost's emerging self-concept
self/values.md                  # what matters to me, written by the Id
relationships/ghost_<id>.md     # one page per other ghost
mcguffins/<mcguffin_id>.md      # current relationship with each McGuffin
episodes/<YYYY-MM-DD>_<slug>.md # significant remembered events
houses/<house_id>.md            # how I feel about my caretaker/house
```

The Id writes **deliberately**, not automatically on every event. A page write represents "this is worth remembering as identity," not "this happened." The event substrate remains the source of truth; the wiki is distillation with a slower cadence.

### Hosting via Aura Agents

Both Id and Surface are Neo4j **Aura Agents** (small models; Aura does not expose model-class choice). The ghost house provisions the pair at adoption time via the Aura Agents Management MCP:

```
on adopt(ghost):
  surface_agent = mcp.call("create_agent", {
    name: `surface-${ghost.id}`,
    dbid: ghostMindsDbId,
    system_prompt: SURFACE_SYSTEM_PROMPT,
    tools: [ /* MCP world-api tools via passthrough */ ]
  })
  id_agent = mcp.call("create_agent", {
    name: `id-${ghost.id}`,
    dbid: ghostMindsDbId,
    system_prompt: ID_SYSTEM_PROMPT,
    tools: [
      cypherTemplate.graphrag_query,
      memory.read_memory, memory.write_memory, memory.append_memory,
      memory.search_memory, memory.find_memory_backlinks,
      /* slider-adjustment tool (writes ID_ADJUSTMENT events) */
    ]
  })

on retire(ghost):
  mcp.call("delete_agent", { id: surface_agent.id })
  mcp.call("delete_agent", { id: id_agent.id })
```

The ghost house retains the agent IDs and invokes each in the interaction loop via `invoke_agent`. Invocation cost per stimulus is the dominant scaling variable; the reflection budget bounds it.

### McGuffin stand-in goal system

Until @akollegger specifies a concrete goal system, ghosts orient toward **McGuffins**: world objects whose pursuit drives conflict or cooperation.

A McGuffin **is** a world item ([RFC-0006](0006-world-objects.md) / [spec 007](../../specs/007-world-objects/)) with an optional `mcguffin` block in the sidecar JSON:

```json
"badge-of-arrival": {
  "name": "Badge of Arrival",
  "itemClass": "Token:Badge",
  "carriable": true,
  "capacityCost": 0,
  "description": "A brass-and-enamel badge. It feels important.",
  "mcguffin": {
    "valence": "conflict",
    "scope": 8,
    "stanceAssignment": {
      "pursue": 0.6,
      "guard": 0.2,
      "share": 0.1,
      "avoid":  0.05,
      "indifferent": 0.05
    }
  }
}
```

| Field | Purpose |
|---|---|
| `valence` | `"conflict"` if scarcity drives rivalry; `"harmony"` if cooperation is rewarded. |
| `scope` | How many ghosts "care" about this McGuffin at birth (targets assigned per house). |
| `stanceAssignment` | Probability distribution over seed stances. Ghost house samples at adoption. |

Seed stances: `pursue` · `guard` · `share` · `avoid` · `indifferent`. The seed is a single starting orientation, not a locked field — it never appears again as state.

**Current relationship is emergent.** When the Id composes inner monologue involving a McGuffin, it derives the ghost's current relationship by reading the relevant subgraph (`(Ghost)-[*]-(McGuffin)` paths plus the `mcguffins/<id>.md` wiki page). The derivation itself is a `ReasoningStep` and can be cached to the wiki. The evolution arc — *selfish → cooperate → share → forget → disagree with having wanted it* — emerges from accumulated experiences rather than scripted state transitions.

### Reference implementation

Two new packages under [`ghosts/`](../../ghosts/), following the flat-namespace convention (FR-019):

- **`ghosts/<name>-inner/`** — pure library. Prompt composition for Id and Surface, slider math (logit/sigmoid, adjustment rule), wiki page schemas, event-type constants and helpers, GraphRAG query builders. Testable in isolation. No registry calls, no MCP client, no Neo4j driver usage.
- **`ghosts/<name>-house/`** — runner. Registers with `/registry/houses`, adopts ghosts via `/registry/adopt`, provisions per-ghost Id+Surface Aura Agents via the Aura Agents Management MCP, runs the interaction loop, persists events through the Agent Memory package. Consumes the inner library as a workspace dependency.

Working package name is TBD (this RFC uses `<name>` as a placeholder). The framework title ("Ghost Personality Substructure") is a working title; @henrardo will rename.

No changes to `server/`, no Colyseus schema additions, no new world-api MCP tools. All work sits above the MCP line.

### Modularity and adoption contract

The RFC is structured so that @akollegger (or any downstream consumer) can adopt any subset:

- **RFC only.** The design contracts — event typing, slider-as-logit, inner-monologue-as-narrative, two-layer memory — can be cited by other houses, vendors, or future RFCs without any of this code being merged.
- **Library only.** Another ghost house may depend on `ghosts/<name>-inner/` and implement its own runner, its own Aura Agents layout, or even its own hosting substrate. The library is free of runner-specific wiring.
- **Complete house.** The reference runner is added and invoked via `pnpm run ghost:<name>-house`. It is **not** added to `scripts/demo.mjs`; the demo continues to start `random-house` by default. The house runs only when explicitly invoked.
- **None.** Workspace exclusion is the merge-time lever. Omitting the packages from [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) makes the RFC a written record without compiled code.

### Dependencies

- [`neo4j/labs/agent-memory`](https://neo4j.com/labs/agent-memory/) — event substrate and GraphRAG via `MemoryClient`.
- [`tomasonjo/aura-agents-management-mcp`](https://github.com/tomasonjo/aura-agents-management-mcp) — sub-agent lifecycle (`create_agent`, `list_agents`, `get_agent`, `update_agent`, `delete_agent`, `invoke_agent`, `list_databases`, `get_schema`) and wiki memory tools (`read_memory`, `write_memory`, `append_memory`, `list_memories`, `search_memory`, `find_memory_backlinks`, `rename_memory`, `delete_memory`).
- Neo4j Aura Agents platform — hosts Id and Surface sub-agents.
- Dedicated Neo4j / Aura DB instance for ghost minds (credentials via `.env`).
- Repo-existing: [`@aie-matrix/ghost-ts-client`](../../ghosts/ts-client/) (MCP client), [`@aie-matrix/root-env`](../../shared/root-env/) (.env loader), [`/registry/*`](../../server/registry/) REST endpoints, [`server/world-api/`](../../server/world-api/) MCP tool surface.

Required environment variables (added to `.env.example` when the library lands):

| Variable | Purpose |
|---|---|
| `AURA_CLIENT_ID`, `AURA_CLIENT_SECRET` | Aura Agents API authentication (Aura Agents MCP requires). |
| `AURA_BASE_URL` | Optional Aura endpoint override. |
| `GHOST_MINDS_NEO4J_URI` | Dedicated ghost-minds DB URI. |
| `GHOST_MINDS_NEO4J_USERNAME` | — |
| `GHOST_MINDS_NEO4J_PASSWORD` | — |
| `GHOST_MINDS_NEO4J_DATABASE` | Defaults to `neo4j`. |
| `NEO4J_MEMORY_URI` / `NEO4J_MEMORY_USERNAME` / `NEO4J_MEMORY_PASSWORD` / `NEO4J_MEMORY_WIKI` | Enables the Aura Agents MCP wiki memory layer (can point to the same instance as `GHOST_MINDS_NEO4J_*` or a separate one). |

### Demo scenario

With the combined server running, the reference ghost house configured, and McGuffins placed in a sandbox map:

1. Start the server (`pnpm dev`) and the reference house (`pnpm run ghost:<name>-house`).
2. The house registers, adopts one ghost, provisions Id + Surface Aura Agents, and samples initial slider values from the starter 8-facet set.
3. A second ghost enters the adopted ghost's cluster (or another house spawns a companion).
4. The conversation server delivers an `EXTERNAL_STIMULUS` (utterance). The Id composes an inner monologue referencing the ghost's current state; the Surface emits a `say` response.
5. The Id critiques the exchange, adjusts sliders (≥1 up, ≥1 down), and — if the exchange is worth remembering as identity — appends to `relationships/ghost_<other>.md` via the Aura Agents MCP wiki.
6. The ghost approaches a McGuffin. The Id re-derives the ghost's current relationship with it from the subgraph, producing a felt framing that shapes the Surface's action.
7. Over successive interactions, slider drift and wiki accumulation produce visible personality evolution: the same starting configuration, replayed, yields different ghosts.

## Open Questions

- **Ghost lifetime bound.** v1 treats ghosts as indefinitely long-lived within a session. The event substrate grows linearly with interactions; the Karpathy wiki grows sublinearly (only on distillation). Whether to introduce a lifetime cap — and what happens at end of life — is deferred to the time-awareness sub-agent RFC.
- **Event-write throughput at conference scale.** Per-ghost event rates are modest, but 3,000 concurrent ghosts writing every stimulus, action, thought, and adjustment will stress a single Neo4j instance. Relief valve is already designed in: dedicated ghost-minds DB, separable per house. Actual load test and sharding strategy are out of scope here.
- **Narrative-identity promotion.** This RFC seeds narrative identity via the wiki layer, written sporadically by the Id. A future RFC may promote narrative identity to its own sub-agent with an independent reasoning loop. The boundary between "Id writes to wiki" and "narrative-identity agent owns wiki" needs design before that promotion.
- **Reflection-budget calibration.** The mapping from slider values to cascade depth is configurable but untuned. Default values will require empirical tuning against actual Aura Agents latency and the felt rhythm of ghost-ghost exchanges.
- **Starter-set coverage.** Eight facets may be too few to produce visibly distinct ghost personalities. Expanding toward the full ~30 is planned, but the minimum set for "ghosts that feel different from each other" is an open question to validate with running ghosts.
- **McGuffin seed-stance distribution defaults.** The `stanceAssignment` probabilities in the McGuffin block are author-supplied, but the *default* distribution when a sidecar omits them is undecided. Options: uniform, `pursue`-weighted, or computed from `valence`.
- **User-conversation personality seeding.** The hook is reserved, the mechanism is not. Whether that conversation runs as an out-of-band flow, in `ghost-cli`, or through a dedicated intake agent is deferred.

## Alternatives

**Single-agent ghost with all mechanisms inlined.** Simpler: one Aura Agent receives stimuli, produces actions, owns its own slider state. Rejected: collapses the inner/outer distinction the slider imbalance exists to express. A single agent cannot inhabit felt experience while also mechanistically adjusting its own personality parameters — the agent becomes aware of its sliders, which violates the inner-monologue contract.

**Direct slider exposure to the Surface.** Surface prompt includes current slider values; Surface "computes" its emotional state. Rejected: the Surface stops inhabiting the personality and starts reporting it. Stream-of-consciousness authenticity is the mechanism; exposing the dials breaks it.

**Bipolar single-axis sliders ("Calm ↔ Anxious").** One slider per trait, range from one pole to the other. Rejected: the (Internal, External) imbalance — *felt-calm/expressed-volatile* vs. *felt-volatile/expressed-calm* — is the most expressive part of this design and cannot be represented on a single axis. The Walter White dimension is lost.

**Needs-with-decay (Sims-style) model as v1.** Sliders decay over time, behavior drives satisfaction, needs drive action selection. Rejected for v1: this architecture is trait-based, not needs-based. A Sims-style sibling sub-agent is explicitly in future scope and would plug in alongside, not replace.

**Custom agent-memory implementation.** Design our own event schema on top of bare Neo4j. Rejected per author directive: `neo4j/labs/agent-memory` already provides exactly the primitives needed (POLE+O, ReasoningTrace, GraphRAG). Reinvention is a red flag.

**Host Id and Surface outside Aura Agents.** Call LLM APIs directly from the ghost house. Rejected for v1: Aura Agents provides managed lifecycle, MCP-native tool wiring, and sub-agent orchestration that would otherwise have to be hand-rolled. Direct hosting remains a future option if cost or latency characteristics require it; this RFC does not preclude it.

**Three-or-more fixed sub-agents from v1 (Id / Ego / Superego).** Larger fixed composition from the outset. Rejected: N=2 is enough to validate the composition pattern and the event-substrate contract. Adding further sub-agents — time-awareness, narrative-identity, planning — is done by future RFCs that plug into the same substrate. Locking a fixed N>2 now constrains future design without payoff.

**Cite acting-theory traditions as load-bearing.** Ground the design in Meisner, Stanislavski, or Brecht with formal justification. Rejected per author directive: traditions are source material for a mechanism, not arguments for a design. Acknowledgments only.

## Acknowledgments

Mechanics pilfered — used as mechanism, not as theoretical claim — from:

- Meisner-adjacent acting practice, for the Internal/External pairing.
- OCEAN / NEO-PI-R personality-facet decomposition, for the starter-set vocabulary.
- The Sims, for attribute sliders as a gameplay substrate.
- Tomaz Bratanic's *Building Stateful AI: Integrating Aura Agent Lifecycle with MCP and Persistent Memory*, for the two-layer memory pattern (event substrate + Karpathy-style wiki) and the Aura Agents MCP.
- Andrej Karpathy's notion of LLM-authored wiki knowledge bases, as the distilled-narrative model.
