# RFC-0015: RDC Skill Tiers & Mathematical Schools

| Status | Draft — decision needed |
|--------|-------------------------|
| Date   | 2026-05-12 |
| Author | @henrardo (drafted with Claude during 2026-05-12 hackathon session) |
| Related | [RFC-0011](0011-ghost-personality-substructure.md) (personality sliders), [RFC-0012](0012-rdc-duels.md) (duels), [RFC-0013](0013-rdc-bounty-hunting.md) (bounty claims — provides the skill-transfer hook), `ghosts/rdc-agent/src/hellmuth-profile.ts` (animal temperament — orthogonal to this RFC) |

## Summary

Give RDC ghosts **deterministic, transferable poker proficiency** by composing two orthogonal axes onto every seated ghost: a **skill tier** (Greenhorn → Journeyman → Veteran → Eagle, gated by `handsPlayed`) and a **mathematical school** (Sklansky / Chen / Harrington / GTO / Exploitative / ICM / Hellmuth — named traditions with different toolkits, rendered to the audience with progenitor-pun flavour names like *Slim Lansky*, *Wild Bill Chen*, *Doc Harrington*, *Grand Theft Oro*, *Doyle the Drifter*, *Independent Chip Marshal*, *Hellmouth*; tier labels prefix in display, e.g. *Greenhorn Hellmouth* or *Veteran Grand Theft Oro*). Tier decides *how much* math is computed and surfaced to the LLM prompt; school decides *which* math. Skill is transferable via bounty claim — kill an Eagle, become one. This is observable behaviour, not just decoration: the saloon overlay shows tier and school badges per seat, and (optionally) the math sheet the seated ghost is being fed.

## Motivation

Today every RDC ghost reaches the table with identical equipment: an OCEAN slider profile, a Hellmuth animal type, and an LLM prompt that hands the model raw stack/bet/position data with no derived math. The model is expected to compute pot odds, equity, range narrowing in its head. The result is uniform, vibes-driven play — there is no mechanical reason a ghost who has played 200 hands should beat one who has played 10.

Three things this RFC unlocks:

1. **Visible progression.** A Greenhorn loses to a Veteran for *legible* reasons — the Veteran is being shown a precomputed equity number; the Greenhorn isn't. Spectators can see the asymmetry on the overlay.
2. **Player-vs-player tension via bounty.** Skill transfer turns the bounty board into an experience economy. The fight is now not just for Aura credits but for the toolkit you carry forward.
3. **Stylistic variety.** Two equally proficient Veterans play *differently* because one follows Sklansky's implied-odds discipline and the other reads opponents through blockers and combinatorics. The audience reads style at the table, not just outcomes.

The skill tier is the gameplay knob; the mathematical school is the flavour knob. Both compose with — but are independent of — the existing Hellmuth temperament. A Lion can be a Greenhorn Chen disciple or a veteran ICM survivor; the temperament decides *whether to push*, the math decides *with what justification*.

## Design

### Two axes, one ghost

```
Ghost {
  // Existing
  personality: PersonalityState        // OCEAN sliders (RFC-0011)
  animalType: HellmuthAnimal           // Mouse | Lion | Jackal | Elephant | Eagle
  // New
  skillTier: SkillTier                 // Greenhorn | Journeyman | Veteran | Eagle
  handsPlayed: number                  // monotonically increasing; persisted in ledger
  mathSchool: MathSchool               // Sklansky | Chen | Harrington | GTO | Exploitative | ICM
}
```

**Note on naming overlap:** "Eagle" is both a Hellmuth animal *and* the top skill tier. They are independent. A `Mouse / Eagle` ghost is a cautious but mathematically deep player. We keep both names because both are flavour-correct in their domain; readers of the codebase should rely on the field, not the noun.

### Tier definitions

Tiers gate the **richness** of a math block injected into the LLM prompt before each decision. Below each threshold the block is silently empty.

| Tier | `handsPlayed` | Math block contains |
|------|---------------|---------------------|
| Greenhorn | 0–9 | (nothing — current behaviour) |
| Journeyman | 10–49 | Pot odds; hand-strength bucket; named draws (`detectDraws`) |
| Veteran | 50–199 | + Bayesian range narrowing per opponent (from this-hand actions + stored tendencies); Monte Carlo equity vs estimated range (~1000 rollouts) |
| Eagle | 200+, or via bounty transfer | + tilt/momentum read (`sessionMomentum`); explicit "fold unless pot odds beat estimated equity" guidance line |

Thresholds are first-pass guesses; expect to tune them. The promotion check runs end-of-hand in `rdc-ledger`.

### School definitions

Schools layer **named math** on top of the tier-defined floor. Every school adds something at every tier it operates at; the additions sit alongside the generic math block.

Each school has a **technical identifier** (used in code as the `MathSchool` enum) and a **flavour name** (shown on the saloon overlay and in spectator copy). Mechanics are bound to the identifier; flavour names are display-only.

Flavour names are puns on the progenitor's name or acronym, mapped into Wild West characters and gambling legends. Tier labels prefix the flavour name in display — *Greenhorn Hellmouth*, *Veteran Grand Theft Oro*, *Eagle Doc Harrington*. Future schools should follow this naming convention.

| Identifier | Flavour name | Pun mechanic | What gets added to the prompt |
|------------|--------------|--------------|-------------------------------|
| `Sklansky` | **Slim Lansky** | Amarillo Slim (Preston) + Meyer Lansky | Sklansky hand-group label (1–8); implied-odds line ("calling X here is fine if you can extract Y on future streets") |
| `Chen` | **Wild Bill Chen** | Bill Chen + Wild Bill Hickok | Numeric Chen score (A=10, K=8, pairs ×2, +2 suited, +1 connected) for hole cards; a play/fold threshold gloss |
| `Harrington` | **Doc Harrington** | Harrington + Doc Holliday | M-ratio (`stack / (SB+BB+antes)`) and zone label (green M≥20, yellow 10–20, orange 5–10, red <5); aggression nudge keyed to zone |
| `GTO` | **Grand Theft Oro** | GTO acronym + Grand Theft Auto + *oro* (Spanish: gold) | Balanced-range hint (precomputed table by position × stack depth — we are *not* running a solver) |
| `Exploitative` | **Doyle the Drifter** | Doyle Brunson + Western drifter | Opponent-specific tendency call-outs (VPIP/PFR/fold-to-3-bet from memory) + blocker count for opponent value combos |
| `ICM` | **Independent Chip Marshal** | ICM acronym preserved, "Model" → "Marshal" | Stack-equity in Aura given current pot prizes; bubble-pressure note when stacks are short. Currently relevant only when the table has a finite buy-in pool; for v1 cash-style RDC tables this is informational. |
| `Hellmuth` | **Hellmouth** | Hellmuth → Hellmouth (mouth of hell) | Hybrid school — Sklansky-style preflop **plus** Exploitative postflop **plus** Hellmuth's signature animal-type opponent classification. (1) Hole-card check against Hellmuth's "Top 10" (AA/KK/QQ/AK/JJ/TT/99/88/AQ/77) as a tightness gate. (2) Predicted Hellmuth animal type per opponent (Mouse/Lion/Jackal/Elephant/Eagle) derived from their VPIP/PFR/fold-to-3-bet in memory. (3) Aggression adjustment based on the table's animal composition — "two Jackals at the table, tighten up; three Mice, run them over." Reads-heavy, anti-GTO by design. |

**On the `Hellmuth` school being a hybrid:** all other schools cleanly extend a single tradition. Hellmuth deliberately combines three (Sklansky tightness + Exploitative reads + his own animal taxonomy) because that's what his book actually advocates. In implementation, the Hellmuth math block calls into `sklansky.ts` and `exploitative.ts` and adds its own animal-classifier module. Worth flagging because it sets a precedent: future "personal-brand" schools may also be compositions rather than pure traditions.

**On the `Hellmuth` animal taxonomy vs. the existing `animalType` field:** the ghost's *own* animal type (in `hellmuth-profile.ts`) describes the ghost's temperament. The Hellmuth school's animal predictions are *of opponents*, derived from observed play. Same taxonomy, opposite direction. We reuse the type definition; we do not conflate the fields.

Schools are **assigned at spawn** and persist. Default assignment heuristic:

- `rdcRole: "marshall"` → uniform random over `{Sklansky, GTO, Harrington}` (lawful/structured schools)
- `rdcRole: "outlaw"` → uniform random over `{Chen, Exploitative, ICM, Hellmuth}` (frontier/opportunist/theatrical schools)

Hellmuth sits in the outlaw pool by personality (showy, anti-GTO, soul-reader) even though his preflop discipline is lawful. If the demo wants exactly one Hellmouth on every table, override at spawn.
- Override via spawn-context for fixed-cast demos.

### Implementation surface

```
ghosts/rdc-math/                       # NEW package — pure functions, no LLM
  src/
    types.ts                           // SkillTier, MathSchool, MathBlock
    math-block.ts                      // computeMathBlock(state, ghost) → string
    schools/
      sklansky.ts                      // Slim Lansky — implied-odds + group label
      chen.ts                          // Wild Bill Chen — Chen formula
      harrington.ts                    // Doc Harrington — M-ratio + zone
      gto.ts                           // Grand Theft Oro — range-table lookup
      exploitative.ts                  // Doyle the Drifter — tendency calls + blockers
      icm.ts                           // Independent Chip Marshal — stack-equity in Aura
      hellmuth.ts                      // Hellmouth — hybrid (calls sklansky + exploitative + animal-classifier)
      animal-classifier.ts             // Hellmouth's animal-type prediction over an opponent's recent play
    tier.ts                            // promotion thresholds + check
    range-tables/                      // precomputed CSV/JSON range hints

ghosts/rdc-ledger/
  + schema:  handsPlayed + skillTier per ghostId
  + API:     recordHandPlayed(ghostId), getSkillRecord(ghostId), transferSkill(fromGhostId, toGhostId, mode)

ghosts/rdc-agent/src/poker-brain.ts
  + before invokePokerBrain: const mathBlock = computeMathBlock(handState, ghost);
  +                          prompt.system += "\n\n" + mathBlock

ghosts/rdc-orchestrator/overlay/
  + per-seat badges: tier + school
  + optional: spectator math-sheet panel (toggle in overlay)
```

The `rdc-math` package is intentionally **stateless** and **LLM-free**. It computes a string and hands it back. The agent injects it.

Borrowed from the existing vendored pokerswarm sources (no rewrite needed):

- [`pokerswarm-ai/src/lib/poker/evaluator.ts`](../../pokerswarm-ai/src/lib/poker/evaluator.ts) — already provides combinatorial hand ranking; Monte Carlo rollouts use it directly.
- [`pokerswarm-ai/src/lib/poker/boardAnalysis.ts`](../../pokerswarm-ai/src/lib/poker/boardAnalysis.ts) — `detectDraws` and `boardTexture` are kept as-is (the hardcoded equity constants 0.54/0.35/0.30 are textbook-correct approximations).
- [`pokerswarm-ai/src/lib/poker/preflopRanges.ts`](../../pokerswarm-ai/src/lib/poker/preflopRanges.ts) — provides position-from-seat and preflop category, used by GTO and Sklansky schools.
- [`pokerswarm-ai/src/lib/poker/handStrength.ts`](../../pokerswarm-ai/src/lib/poker/handStrength.ts) — strength buckets for the Journeyman tier.
- [`pokerswarm-ai/src/lib/poker/sessionMomentum.ts`](../../pokerswarm-ai/src/lib/poker/sessionMomentum.ts) — feeds the Eagle-tier tilt read.

### Skill transfer via bounty claim

This is the lever that makes tier feel like a stake.

[RFC-0013](0013-rdc-bounty-hunting.md) defines the bounty-claim event. On a successful claim, the hunter's `(handsPlayed, skillTier)` is updated against the target's via a configurable `transferMode`. See **Open Questions** for the choice between `replace | max | merge`.

The dead ghost's record is *not* zeroed — they may respawn later (RFC scope tbd), but the experience is "carried" by the hunter from the moment of claim.

### Observability

- **Saloon overlay** ([orchestrator/overlay/index.html](../../ghosts/rdc-orchestrator/overlay/index.html)): per-seat row gains two badges, e.g. `[Veteran | Chen]`. Colour-coded by tier.
- **Spectator math-sheet panel** (optional, toggle): renders the actual math block being fed to the LLM that turn. This is the "watch the maths" view — useful for demos and for verifying that Eagle ghosts really are getting richer prompts.
- **Logging**: orchestrator emits `rdc-orch.skill-promote` JSON lines on tier promotions and `rdc-orch.skill-transfer` on bounty-driven transfers.

### Non-goals (v1)

- **No real GTO solver.** We use precomputed range tables. Building or shipping a CFR solver is out of scope.
- **No school propagation.** Schools don't spread via mentoring/teaching between ghosts; assignment is at spawn only. (v2 candidate.)
- **No duels integration.** Duels (RFC-0012) will get their own skill RFC; the math toolkit there is different (one-shot showdowns, not multi-street decisions).
- **Tournament-mode ICM** with finite payout pools is out of scope; the ICM school remains useful at cash tables for survival-weighted decision pressure but won't compute true dollar equity until a tournament RFC lands.

## Open Questions

1. **Bounty-claim skill transfer semantics** — `replace`, `max(self, dead)`, or `merge` (sum hands played, take higher tier)? Each has flavour implications:
   - `replace`: kill an Eagle, become an Eagle even if you were a Greenhorn yesterday. Most dramatic.
   - `max`: you gain only what you didn't already have. Conservative.
   - `merge`: hands-played sums; tier is recomputed. Rewards aggregation over a hunting career.
   - Author leans `max` for v1 (clean semantics, no math-tier inflation), revisit if escalation feels too slow.

2. **Should `mathSchool` be visible to opponents?** If yes, opponents can adapt. If no, it's hidden information and reading the school becomes part of the game. Leaning *no* for v1 (the badge is overlay/spectator-only, not in the encounter or invite payload), but this is a design choice with consequences.

3. **Tier thresholds.** 10/50/200 are guesses calibrated to "demo-visible progression within an evening." Need to tune against actual session length.

4. **What happens when a ghost has multiple bounties claimed?** Iterate transfers; cap at Eagle. Confirm that's right.

5. **Schools at Greenhorn.** Does a Greenhorn show *any* school-specific math, or does the school only kick in at Journeyman+? Current draft says "school adds on top of tier floor" which means Greenhorn = nothing regardless of school. That's clean but loses early-game flavour. Alternative: each school adds one cheap signature line even at Greenhorn (e.g. a Chen disciple sees their Chen score from hand 1). Worth deciding.

6. **Prompt-injection budget.** The math block adds tokens to every poker decision. At Veteran+ the block could be ~300–500 tokens. Verify this doesn't degrade brain quality or cost projections.

## Alternatives

**1. Single-axis "skill" scalar.** Drop the school axis; just have ghosts get mathematically better with experience. Simpler to implement and reason about. Loses the named-traditions flavour that makes the system distinctive — a Veteran is just "a better player," not "Sklansky-trained."

**2. School without tier.** Give every ghost a school at spawn; don't gate by experience. Schools become pure flavour from hand 1. Easier to implement, but loses the bounty-driven progression hook — there's no reason to hunt an Eagle.

**3. Implicit math via fine-tuned prompts only.** Skip the `rdc-math` package; just hand the LLM richer textual hints based on `handsPlayed`. Lighter to build, but inherits the existing problem: math correctness is at the model's mercy, and we can't show spectators the actual numbers because we never computed them.

**4. Solver-grade GTO.** Ship a real CFR solver, run it offline, embed the strategy tables. Highest fidelity, much higher implementation cost (weeks not days), and conflicts with the "fits in a hackathon" constraint that birthed RDC. Park for a future RFC if GTO play becomes load-bearing.

**5. Animal type *as* school.** Collapse Hellmuth animals into mathematical schools (Eagle → GTO, Lion → Exploitative, etc.). Less flexible — temperament and math become tied — and Hellmuth's own taxonomy is about emotional/social style, not mathematical lineage. Two axes give richer cross-products (a Mouse Sklansky disciple is a recognisable character; a Lion Chen disciple is different from a Lion GTO).
