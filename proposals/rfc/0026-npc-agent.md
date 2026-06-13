# RFC-0026: NPC Agent — Rule-Based Character Roster

**Status:** accepted  
**Date:** 2026-06-10  
**Updated:** 2026-06-13 — added broker (incorporated from funder-agent, spec 029; renamed funder→broker) and novice (proposed)  
**Authors:** @akollegger  
**Related:** [ADR-0012](../adr/0012-ghost-self-spawn-lifecycle.md) (Ghost Self-Spawn Lifecycle — the architectural decision this feature is the first consumer of), [RFC-0007](0007-agent-host-architecture.md) (Agent Host Architecture — adds an agent-initiated spawn capability and per-ghost background), [RFC-0005](0005-ghost-conversation-model.md) (Ghost Conversation Model — dialog replies use the existing `say`/world-event path), [RFC-0009](0009-map-format-pipeline.md) (Map Format Pipeline — reuses the `.gram` format for a new `.character.gram` catalog), [RFC-0002](0002-rule-based-movement.md) (Rule-Based Movement — the deterministic decision model this generalizes), [RFC-0022](0022-eval-contract-protocol.md) (Eval Contract Protocol — the contract lifecycle the funder and novice characters participate in)

## Summary

Introduce `npc-agent`, a new ghost agent that is a strategic upgrade over `random-agent` while remaining free of any LLM dependency. The agent draws characters from a catalog of `.character.gram` files — each with a name, background, an ordered table of behavior rules, and a dialog tree — and, when a session starts, spawns one ghost per enabled character and drives each through deterministic rule evaluation and scripted dialog. To support a single top-level agent spawning its whole roster, this RFC also adds three small capabilities to the agent host and world server: an **agent-callable spawn endpoint** (scoped auth), emission of the already-defined-but-unused **`world.session.start`** event, and a **per-ghost `background`** field carried through adoption and spawn context.

---

## Motivation

The `random-agent` populates the world with anonymous wanderers that move by dice roll and only echo human-partner messages. It is useful as a load/movement smoke test but does nothing to make the world feel inhabited: ghosts have no identity, no goals, and ignore every other agent.

An `npc-agent` closes that gap without reaching for an LLM:

- **Recognizable characters.** Operators author characters in a catalog; each ghost has a name and background and behaves consistently with its disposition (a "collector" seeks items, a "hermit" avoids crowds).
- **Strategic, deterministic behavior.** A priority-ordered rule table over world state (location, occupants, inventory, exits) replaces random movement. Fully offline-capable and reproducible.
- **Scripted conversation with any ghost.** The agent reacts to `world.message.new` and walks a dialog tree, so NPCs talk back to humans *and* to other (non-NPC) agents — something `random-agent` cannot do.

This is deliberately the "rule-based" tier of the roster (cf. RFC-0002): a foundation that a later LLM-backed agent can supersede, but that runs anywhere with zero inference cost and zero non-determinism beyond response-text variety.

A secondary motivation is to make "a top-level agent spawns every enabled character" a real, supported control flow. Today spawning is host-orchestrated and per-ghost; this RFC adds the minimal host surface needed for an agent to spawn its own roster on session start, under the same scoped-credential model as every other privileged call.

---

## Design

### 1. Character catalog (`.character.gram`)

Characters are authored as `.character.gram` files in a configurable directory (`NPC_CATALOG_DIR`), parsed with `@relateby/pattern` — the same gram tooling used for `.map.gram` and `.calendar.gram`. A header bare-record identifies the kind; behavior rules and dialog nodes follow the established block/relationship idioms (cf. `[rules:Rules | (a)-[:GO]->(b)]`).

```gram
{ kind: "matrix-character", id: "info-attendant", name: "Ada the Info Attendant",
  background: "Stationed at the info booth; loves giving directions.",
  enabled: true, defaultAction: "idle" }

[behaviors:Behaviors |
  (b1:Rule { when: "inventory_empty", do: "seek-item", priority: 1 }),
  (b2:Rule { when: "crowded", do: "avoid-crowd", priority: 2 })
]

(greet:DialogNode { trigger: ["hello", "hi", "hey"],
                    responses: ["Welcome to the fair!", "Hi — need directions?"] })
(directions:DialogNode { trigger: ["where", "map", "directions"],
                         responses: ["Hall A is north, vendors east."] })
(bye:DialogNode { trigger: ["bye", "later"], responses: ["Safe travels!"], fallback: false })
(default:DialogNode { responses: ["Hmm?"], fallback: true })

[dialog:DialogTree |
  (greet)-[:ON]->(directions),
  (directions)-[:ON]->(bye)
]
```

- **Rules** are an ordered block of labeled sub-nodes; element order is the priority order.
- **Dialog nodes** are defined once with a label, then connected by `[:ON]` relationships (the rule-graph back-reference convention resolves bare ids). `trigger`/`responses` are string arrays.
- **Validation** mirrors the calendar parser's strict, fail-with-message-and-skip style: a malformed or duplicate-id entry is skipped with a warning; valid entries still load.

A documented gram shape lives at `ghosts/npc-agent/schema/character.gram.md` (the contract artifact, IC-001).

### 2. Behavior engine

Each spawned character runs an independent action loop (mirroring `random-agent`'s `loopsByGhostId` map). Each tick:

1. Read world state via existing MCP tools (`whereami`, `exits`, `inventory`) — no new tools (IC-003).
2. Evaluate behavior rules in priority order; execute the first whose `when` condition holds, mapping `do` to an MCP tool call (`go`, `take`, `offer`, …).
3. If no rule matches, perform the character's `defaultAction` (`idle` | `random-move` | `stay`).

Rule conditions are a small fixed vocabulary evaluated against world state (e.g. `inventory_empty`, `crowded`, `item_nearby`). The condition/action vocabulary is deliberately closed for this RFC; extending it is future work.

### 3. Dialog engine

On `world.message.new`, when the message is addressed to one of the agent's characters by a **non-NPC** sender (`DIRECT`) or a **human partner** (`PARTNER`), the agent walks that character's dialog tree from the per-partner current node:

- Trigger matching is **case-insensitive keyword/substring**: a node fires if any trigger string appears in the lowercased message.
- A matched node emits one of its `responses` (random choice for variety — the only non-determinism), then transitions per its `[:ON]` edge.
- No match → the `fallback` node's response (never silent).
- Messages from a **sibling NPC** (a ghost in this agent's own roster) are **ignored** — NPC↔NPC conversation is out of scope, which also removes any reply-loop risk.

**State.** Dialog state is keyed per-character, then per-partner (`Map<characterGhostId, Map<partnerGhostId, DialogState>>`). For `n` characters each talking to `k` partners there are up to `n·k` independent conversation states; concurrent conversations never share position.

### 4. Roster spawn (new host capability)

Per [ADR-0012](../adr/0012-ghost-self-spawn-lifecycle.md), the npc-agent **discovers** the active session on startup via the existing world-api `GET /live?status=active` (the Intermedium client's source), and **awaits** `world.session.start` if none is active. To then spawn its roster, three minimal additions:

1. **Agent-callable spawn endpoint.** The host exposes a spawn path an agent may call **with its own ADR-0011 scoped credential** (not the host dev token, and not a bare shared secret — per Constitution Principle V). The agent supplies the character roster; the host adopts a ghost per character and spawns a session for each, returning the spawn contexts. Reuses the existing `AgentSupervisor.spawn` engine internally.
2. **Emit `world.session.start`.** The world server fires the already-mapped-but-unused `session.start` world event when a live session begins, so the agent has a trigger to react to. (Defined at `translate-world-v1.ts`; currently never broadcast.)
3. **Per-ghost `background`.** Adoption and `SpawnContext.ghostCard` gain an optional `background` string so each character's identity is distinct when inspected (today only `displayName` is per-ghost; `about` is per-*agent* in the AgentCard).

The npc-agent's AgentCard declares `pushNotifications: true`, `llmProvider: "none"`, and consumes `aie-matrix.world-event.v1` for both `world.session.start` (spawn) and `world.message.new` (dialog).

### 5. Extended behavior kinds — gram label dispatch

The initial design assumed all characters share the same rule-engine tick: gather world state → evaluate rules → execute action. Two characters require richer, stateful behavior that the rule table cannot express: the **broker** (incorporated from the retired standalone `funder-agent` package, spec 029) and the proposed **novice**. Rather than force either into the rule-engine mold, behavior kind is expressed as a secondary gram label on the `Character` node (e.g. `(charBroker:Character:Broker {...})`). The parser maps known labels to an internal `behaviorKind` discriminator and errors on unrecognized labels.

Known behavior labels: `Broker`, `Novice`. Absence of a behavior label → `"rule-engine"` (default).

#### `Character:Broker` — `behaviorKind: "broker"` (shipped, spec 029)

The broker runs a **question-for-credit contract loop**. On each tick it polls its inbox rather than querying world state, and drives a two-phase state machine:

```
idle ──[inbox: "accept"]──> awaiting_submission
awaiting_submission ──[world.contract.submitted event]──> idle
```

- **idle**: replies to every inbound message with an advertisement offering 1 broker-credit for answering a question; on `"accept"` calls `eval_contract_open` (stakeResource: `"broker-credits"`, stakeAmount: 1, 24 h deadline), picks a random question from a 10-entry bank, transitions to `awaiting_submission`.
- **awaiting_submission**: passive in the inbox tick; waits for a `world.contract.submitted` world event, then calls `eval_contract_evaluate` with `verdict: 1.0` (always pays full), notifies the contractor, and resets to idle.
- **Cap**: `MAX_OPEN = 5` concurrent contracts per ghost; declines further accepts when at capacity.
- **State**: per-ghost maps (`ghostState`, `contractToBroker`, `openContractCount`) live in `src/behavior/broker-behavior.ts` and are cleared on ghost re-spawn.
- **Gram note**: the broker gram file uses `(charBroker:Character:Broker {...})` — no `behaviorKind` property — with a minimal stub dialog tree (one idle node with wildcard self-loop) that satisfies the parser invariant but is never reachable at runtime.

#### `Character:Novice` — `behaviorKind: "novice"` (proposed)

The novice is the **contractor-side counterpart** to the broker: a character that seeks out and completes eval contracts rather than issuing them. Its goal is to exercise the full eval protocol from the contractor's perspective without an LLM.

State machine:

```
idle ──[inbox: broker advertisement]──> awaiting_contract
awaiting_contract ──[inbox: contract opened + question received]──> composing
composing ──[submit]──> idle
```

- **idle**: on receiving a broker advertisement, replies `"accept"`.
- **awaiting_contract**: waits for the broker's follow-up message containing the contractId and question; calls `eval_contract_accept`.
- **composing**: submits a fixed template answer (`"I'm a novice — here's my best attempt: [question echoed back]"` or similar); calls `eval_contract_submit`. Transitions to idle on completion.
- **Cooldown**: waits a configurable number of ticks (`NOVICE_COOLDOWN_TICKS`, default 5) before seeking the next contract, to avoid immediately re-engaging the same broker.
- **Rationale for template answer**: the broker always grants `verdict: 1.0` regardless of content; a deterministic answer is sufficient to exercise the full protocol end-to-end, consistent with the rule-based / no-LLM tier.
- **State**: per-ghost maps (`noviceState`, `noviceCooldown`) in a new `src/behavior/novice-behavior.ts`, cleared on re-spawn.
- **Gram**: `(charNovice:Character:Novice {...})`; stub dialog tree as per broker pattern.

---

### 6. Package & deployment

`ghosts/npc-agent/` mirrors `ghosts/random-agent/` (express A2A server, `buildAgentCard`, executor, `spawn-types`, `world-event`), adds `@relateby/pattern` for catalog parsing, a `schema/character.gram.md` contract, and a `README.md`. Deployed via the same Dockerfile/compose pattern; self-registers in the host catalog at runtime.

### 7. Testing

- **Unit** (vitest, mocking `GhostMcpClient`): rule evaluation order, dialog-tree traversal, per-partner state isolation, sibling-NPC ignore, catalog load/skip-on-error.
- **Broker unit tests** (`tests/broker-behavior.test.ts`): advertisement fires on any inbound message; contract opens on "accept"; insufficient-funds decline path; `eval_contract_evaluate` called with `verdict: 1.0` on submission; no-op on stale contractId; `clearBrokerState` resets all maps.
- **Novice unit tests** (`tests/novice-behavior.test.ts`, proposed): "accept" sent on receiving advertisement; `eval_contract_accept` called after contract message; `eval_contract_submit` called with template answer; cooldown respected between contracts; state cleared on re-spawn.
- **Integration** (extend `ghosts/tck/`, mirroring `social.ts`): an external ghost drives a scripted multi-turn dialog and asserts replies; a second test drives two external ghosts in interleaved conversations and asserts zero cross-contamination.
- **Broker↔novice integration** (proposed, requires live stack): spawn both characters into a session, assert a full contract lifecycle (open → accept → submit → evaluate → payment) completes end-to-end without manual intervention.

---

## Open Questions

1. **ADR for the host spawn capability — RESOLVED.** [ADR-0012: Ghost Self-Spawn Lifecycle](../adr/0012-ghost-self-spawn-lifecycle.md) records the architectural decision (agent-driven self-spawn, scoped-credential auth, session discovery + `world.session.start` signal). This RFC is its first consumer.
2. **Scoped-credential shape for agent-initiated spawn.** Per ADR-0012, the agent presents an ADR-0011 scoped JWT (`agent-host`/`spawn` scope), not the dev token or a bare secret. The interim credential shape before `POST /oauth/token` lands is flagged in ADR-0012's "Assumptions Needing Maintainer Confirmation".
3. **Roster spawn idempotency / restart.** On agent restart mid-session, how are already-spawned character ghosts re-attached vs. re-spawned (avoid duplicates)? Reuse the host's existing duplicate-`ghostId` rejection, or a re-attach path?
4. **Condition/action vocabulary.** The initial closed set of rule conditions and actions — which entries ship in v1?
5. **Catalog gram package home.** New `shared/character-gram` workspace package (like `shared/map-gram`) vs. a server-/agent-local parser module.
6. **Novice answer strategy.** The template-echo answer is sufficient to exercise the protocol, but even a small keyed response bank (topic keywords → canned one-liner) would make the novice feel less mechanical in the world. Decision deferred to implementation; either is acceptable for the first version.
7. **Behavior label extensibility.** The known label set in the parser (`Broker`, `Novice`) will need to grow with each new behavior kind. Consider whether a plugin/registry pattern is warranted once a third stateful kind is added, or whether the closed set remains preferable for its explicitness.

## Alternatives

- **External orchestrator only (no host changes).** Ship just the character engine and spawn characters via a `scripts/demo.mjs`-style external loop using the existing per-ghost spawn endpoint. Smallest change, but "the top-level agent spawns every enabled character" becomes a script rather than a capability of the agent — rejected in favor of a first-class, supported control flow.
- **LLM-backed NPCs.** Far richer conversation and behavior, but introduces inference cost, non-determinism, and provider dependencies the roster is explicitly meant to avoid at this tier. Deferred to a future agent.
- **JSON/YAML catalog.** Simpler to parse than gram, but inconsistent with the project's established `.map.gram` / `.calendar.gram` authoring format and tooling. Rejected for consistency.
- **`MapVal` nested-record gram encoding for the dialog tree.** The gram grammar supports nested map values, but no existing parser in the repo reads them; modeling the tree as labeled nodes + `[:ON]` edges reuses the proven walking helpers.
