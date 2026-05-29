# RFC-0022: Third-party-mind modeling — predictive peer models in the cascade

| Status | draft |
|--------|-------|
| Date   | 2026-05-28 |
| Authors | @henrardo |
| Related | [RFC-0011](0011-ghost-personality-substructure.md) (slider model), [RFC-0021](0021-ghost-substrate-extraction.md) (the substrate this lands inside), [RFC-0005](0005-ghost-conversation-model.md) (utterance / cluster mechanics — the perceptual input to a peer model) |

## Summary

Give every ghost a small, mutable, predictive model of every other ghost it has perceived in its current cluster — a guess at that neighbour's needs, feelings, recent commitments, and likely next move. The cascade reads peer models on input, updates them on every stimulus that exposes something about a peer, and decays / drops them as peers fall out of sight. The surface agent uses peer models to shape outgoing speech and action ("you believe Lesser Pink seems hungry too"). Peer models persist across pause/resume cycles alongside personality, needs, and commitments.

The point of this RFC is to commit to peer modelling as a substrate primitive — every ghost in every house gets it — and to lock the shape of the data, the update path, and the prompt contract before any code is written. Implementation will follow.

## Motivation

### What ghosts can do today

Peppers ghosts perceive each other through two stimuli — `cluster-entered` (a peer's `ghostId` arrived in the 7-cell view) and `utterance` (a peer spoke into the shared thread). The cascade reads each stimulus once and reacts. Between cascades, the only thing the ghost remembers about a neighbour is whatever ended up in their own commitment ledger or monologue. The neighbour is otherwise an opaque event source: name, sometimes a sentence, no model of *who they are right now*.

### What this misses

A creature among other creatures is a different cognitive entity from a creature alone, and the difference shows up in mechanics, not metaphor:

1. **No second-order recognition.** Two ghosts both starving cannot recognise each other as starving. The capture file already shows ghosts talking *as if* they were tracking peers' hunger ("show me what you've already noticed moving and I'll tell you what looks like it feeds") — but that's the LLM confabulating shared state from the utterance text, not the substrate carrying it. Once the utterance scrolls out of the stimulus window, the inferred shared-need disappears.
2. **No reputation.** "Disturbing Copper Cheetah lied to me last time" or "Lesser Pink kept their promise" cannot exist because the ledger only records what *this* ghost committed to. Coordination beyond one cascade requires remembering what the *other* ghost did.
3. **No intent anticipation.** The surface agent can read its own primal drive but not a peer's. The cascade cannot decide "I'll wait for Embarrassed Teal Ant to move first because they seem on the verge of bolting" — the substrate has nowhere to write down "seems on the verge of bolting."
4. **One-shot social interaction.** Every cluster encounter is essentially the first. Trust, suspicion, alliance, and grudge are not available as state — only as whatever the LLM happens to retrieve from memory at the moment of speaking, which is unreliable for ghosts that don't have long memories yet.

The current architecture treats peers as stimulus producers. To get social behaviour beyond pattern-matching the current utterance, the substrate has to treat them as minds the ghost is *modelling*, not just *hearing*.

### Why this is a substrate primitive, not a peppers-agent feature

Per [RFC-0021](0021-ghost-substrate-extraction.md) the cognitive layer is being lifted out of `peppers-agent` into the shared substrate. Peer modelling belongs there for the same reasons needs, commitments, and the Id pipeline do: every house's ghosts need it, and shipping it in one house first locks the parallel-implementation pattern that 0021 is trying to undo. The RDC poker ghost wants to read "Hellmuth seems to be on tilt" off of a peer model; the Matrix-house Morpheus ghost wants to read "this peer seems convinced their reality is real" off of a peer model; both should pull from the same substrate field.

### Why now

Adding peer models *after* RFC-0021 lands is cheaper than retrofitting them later. The substrate's `runHouse` is gaining `PeppersGhostState` fields for personality, needs, and commitments anyway; one more field is a marginal addition. Delaying past the substrate extraction means every house's brain wrapper has to add peer-state plumbing of its own, which is exactly the duplication 0021 exists to prevent.

This RFC is also the first cognitive primitive that takes another ghost's *interior* as an input — earlier work was self-contained (sliders, needs, drives are all about *this* ghost). Getting the contract right early matters because every downstream social mechanic — trust, alliance, betrayal, conversion in the Matrix house — depends on it.

### A note on framing

This is a mechanical claim about how a ghost behaves in a cluster, not a positional claim about which animals exhibit theory-of-mind, what age it appears in humans, or whether large language models "really" simulate other minds. The mechanic is: *the ghost keeps a guess about each peer, updates it on every observation, and reads it before deciding what to say or do*. Whether that constitutes empathy is a question for the reader; whether it changes observable behaviour in the world is the design's job to make true.

## Design

### State shape

The substrate's `PeppersGhostState` gains one field:

```ts
interface PeerModel {
  /** This ghost's best guess at the peer's primal need state. */
  readonly needs: NeedProfile;
  /** This ghost's best guess at the peer's current dominant feeling
   *  archetype (the four-quadrant dyadic-feeling output already used
   *  for the self). Null when no read has been formed yet. */
  readonly dominantFeeling: FeelingArchetype | null;
  /** Short-form prose summary of "what this peer seems to want right
   *  now" — feeds the surface agent's prompt context. */
  readonly intent: string | null;
  /** Recent commitments the peer is observed to have made — extracted
   *  from utterances ("I'll head north") or from cluster events. Held
   *  separately from the self-ledger; bounded to a small recent window
   *  (e.g. last 5). */
  readonly observedCommitments: ReadonlyArray<{
    readonly text: string;
    readonly cascadeIndex: number;
  }>;
  /** Cascade index at which this model was last updated by direct
   *  observation. Used for staleness / decay. */
  readonly lastObservedAt: number;
  /** Cascade index at which the peer was first observed in any cluster
   *  this ghost has been in. Useful for "have I met this one before?"
   *  decisions. */
  readonly firstObservedAt: number;
  /** Soft confidence in the read, 0..1. Drops with staleness; rises on
   *  fresh observation. Not a probability — a heuristic the prompt can
   *  reflect ("you have a vague sense" vs "you are fairly sure"). */
  readonly confidence: number;
}

interface PeppersGhostState {
  // ... existing fields
  readonly peerModels: ReadonlyMap<GhostId, PeerModel>;
}
```

Storage is `peerId → PeerModel`, not `(self, peer) → PeerModel`. Each ghost owns and persists its own view of every peer it has met. There is no shared registry; an asymmetric view is the whole point. If Disturbing Copper Cheetah thinks Lesser Pink is starving but Lesser Pink does not think they are starving, both views are correct — they are different minds.

### Update path

A peer model is touched at three points in a cascade:

1. **Stimulus ingestion** — when the polled stimulus involves a peer:
   - `cluster-entered { ghostIds }` — for each id, if no model exists, initialise with `needs = midpointNeeds()`, `confidence = 0`, `firstObservedAt = cascadeIndex`. Existing models are touched (`lastObservedAt = cascadeIndex`) but not otherwise re-estimated yet — entering view alone tells you a peer is present, not how they feel.
   - `utterance { from, text, intent? }` — kicks off a *peer-read sub-pass* (see below) that produces a fresh `PeerModel` update for `from`.
   - `cluster-left { ghostIds }` — leave the model in place; mark stale (will decay).
2. **Cascade-end** — every model whose `lastObservedAt` is the current cascade has its confidence reset to a high value (e.g. 0.9). Every other model has its confidence multiplied by a decay factor (e.g. 0.85). Models past a staleness threshold (e.g. `cascadeIndex - lastObservedAt > 50`) are dropped.
3. **Persistence** — on cascade completion, `peerModels` is included in the `onPeerModelsUpdate` callback (mirrors the existing `onNeedsUpdate` / `onCommitmentsUpdate` path), so models survive pause/resume.

The peer-read sub-pass is a single LLM call separate from the Id facets — its job is narrow: given an utterance and the current model of the speaker, produce a revised model. Inputs are the peer's prior `PeerModel` (if any), the new utterance, the current cascade's world context (so the read is grounded in what's actually happening). Output is a `PeerModel` literal: estimated needs (as Maslow-tier-1 verbal labels mapped back to slider space at the boundary — `Don't strap the LLM to a calculator`), a feeling archetype pick, a short intent string, and any observed commitment extracted from the utterance.

### Prompt contract

Two prompts read peer models:

1. **Id impulse / Surface system fragments** gain a `PEER MODELS` section listing, for each peer currently in the cluster, the model in plain prose: *"Lesser Pink Anaconda — you have a strong sense they are hungry; they said 'I'll head north toward the smells' two cascades ago; they seem to be looking for food, not for company."* No numbers. The boundary rule from `Don't strap the LLM to a calculator` applies: needs are surfaced as labels, confidence is surfaced as a hedging adverb (vague sense / fairly sure / strongly sense), and commitments are quoted verbatim.
2. **Peer-read sub-pass system prompt** says: *"You are making a guess about another ghost based on what they just said. Output a structured read: what they seem to need, what they seem to feel, what they seem to be about to do. You are guessing — say so when the evidence is thin. Do not assert facts you cannot infer from the utterance."*

The surface system prompt gains one rule: *"When you mention what a peer seems to want or feel, mark it as your guess — 'seems', 'I think', 'looks like' — not as fact."* This is the same boundary-rule pattern already used for primal drives — surface the *inference* without bolting numbers to the LLM's interface.

### Persistence

Peer models join the existing pause/resume contract from RFC-0019 (Barnacle):

- `runHouse` accepts `initialPeerModels?: ReadonlyMap<GhostId, PeerModel>` and emits `onPeerModelsUpdate(state)` per cascade.
- `PeppersGhostState` carries `peerModels` alongside `personality`, `needs`, `commitmentLedger`.
- A pause/resume cycle (handoff to a mini-game and back) restores peer models intact — a ghost coming back from a poker session remembers what they thought of their neighbours before sitting down.

The Barnacle handoff bundle does *not* include peer models. The in-game ghost is a different cognitive entity (per RFC-0019) and forms its own reads at the table. The persistent ghost's peer models resume on return.

### Observability

Two visibility additions:

1. **Capture file (`PEPPERS_CAPTURE_LOG`)** — every cascade record gains `peerModelsAfter`, a serialised snapshot of the current `peerModels` map. The post-hoc query "did Disturbing Copper Cheetah ever revise their read on Lesser Pink?" becomes mechanical.
2. **Overlay card** — a new "Peer reads" card lists the current ghost's models of every peer in the cluster: name, guessed feeling, guessed top need, confidence as a bar, last-observed cascade. Optional and behind a debug toggle, since it exposes one ghost's interior view of others to the spectator — useful for tuning, but not necessarily always-on.

### Failure modes & guards

- **Runaway model count.** A ghost crossing many clusters could accumulate models indefinitely. Cap at e.g. 64 models, drop the least-recently-observed on insertion overflow. Loud-fail the cap in the capture file so it shows up.
- **LLM read disagreement with reality.** The read might be wrong — that's fine, it's a guess. But persistently wrong reads on the same peer indicate either a brittle peer-read prompt or genuinely deceptive behaviour from the peer (interesting!). Either way, the substrate does not arbitrate; it just records.
- **Peer-read latency.** One extra LLM call per utterance is the cost. If the cascade is already under time pressure (it isn't yet, but could become so), the read can be deferred to cascade-end batch — read every received utterance once, post-hoc. Simpler in v1: read inline.

## Open Questions

1. **Peer-read scope — first-party only?** The Barnacle Protocol contemplates third-party Python mini-games. Should those games' ghosts also build peer models? If yes, the peer-model contract becomes part of the cross-language schema. If no, peer models are JS-substrate-only. Lean: substrate-only for v1; revisit if a non-JS contributor wants it.

2. **Confidence as a single scalar — sufficient?** Confidence today is one number. But a ghost might be highly confident about a peer's *need* while having no idea what they *feel*. Multi-dimensional confidence (per field) is more honest but a bigger surface. Strawman: one scalar; revisit if surface prose feels coarse.

3. **Should observed commitments feed the *self* ledger as IOUs?** If Lesser Pink says "I'll head north," and this ghost has an open commitment to "find food together," should the substrate auto-link Lesser Pink's commitment as a dependency? Probably no in v1 — keeps the self-ledger pure; reads happen at the surface-prompt level.

4. **Decay function shape.** Exponential per-cascade is simple. But peer models from yesterday probably *should* decay much faster than peer models from this cluster's first cascade — emotional read is fresher than need read. Per-field decay rates? Defer until we see the v1 in action.

5. **Should the peer-read sub-pass run during the Id facets, or as a separate pre-pass?** A separate pre-pass means the Id facets receive `peerModels` already updated. Running inside the Id facets risks circular reads (facet asks "what does Lesser Pink feel?", peer-read asks "what does this ghost feel?"). Strawman: separate pre-pass.

6. **What does a *wrong* peer model look like, and do we want to model deception?** A ghost that lies in an utterance produces a misread in the peer's model. That's already supported — the read is just inference from text. But should the lying ghost *know* that their peer has been misread? Deception modelling is interesting and out of scope; v1 reads what's said, accepts what's said, no second-order meta-modelling.

7. **Where does the *cost* of peer modelling come from?** Should building / maintaining peer models deplete a need (Coherence? Rest?)? Mechanically: more peers in cluster → faster Coherence decay? This couples social load to the existing primal-need machinery; could produce "social fatigue" emergently. Defer until needs-coupling work lands.

## Alternatives

1. **No peer modelling — retrieve from conversation memory.** Treat the conversation thread as the authoritative record; when needed, the LLM retrieves and re-reads relevant prior utterances. Cheap, no new state. Loses: persistent reads across long absences, structured confidence, the ability to act on a peer model *before* the next utterance arrives. The LLM's social state becomes whatever happens to be retrievable, not a tracked field.

2. **Shared peer state in a registry service.** All ghosts publish their externally-visible state (current need urgencies, dominant feeling) to a registry; peers read from the registry rather than guessing. Easy to implement, dissolves the whole point — empathy is the *guess* one mind makes about another, including the possibility of being wrong. Shared truth is not modelling; it is a sensor. Rejected.

3. **Peer state embedded in the stimulus rather than in ghost state.** Each `utterance` stimulus carries a "speaker state hint" computed by the substrate at emit time. Easier than ghost-side modelling; loses persistence (no model of a peer who hasn't spoken this cascade), and loses asymmetry (every recipient sees the same hint).

4. **Model only the immediate cluster, no persistence.** Peer models exist for the duration of a co-presence; on `cluster-left`, drop the model. Simpler. Loses: trust, grudge, reputation across multiple encounters. The Matrix-house mechanic (Morpheus convincing peers over multiple visits) becomes impossible. Rejected as foreclosing too much.

5. **Per-pair models — `(self, peer) → PeerModel` symmetric storage.** Doubles writes (every cascade updates both directions) but lets us later add "what I think Y thinks of me." Out of scope for v1 — single-direction is enough to unlock the v1 behaviours; per-pair becomes interesting only when meta-cognition matters (Matrix house, RFC-0021 §future-vision).

6. **Model only via deep-LLM dialogue context, no structured fields.** Pass the full recent dialogue to the LLM on every cascade and let it form whatever peer model it likes implicitly. Maximally LLM-trusting; loses observability (no field to capture, no overlay card, no post-hoc query), couples behaviour tightly to context-window size, and provides no structured input for non-LLM-driven mechanics like reputation or trust accumulation. Rejected — the substrate's value is *making cognition observable and tunable*; an opaque-LLM-mind has neither.
