# Sleep-consolidation findings — Step F LIT

**Verdict: the behavioural acceptance criterion is met.** One awake → sleep → awake cycle measurably concentrated a ghost's stimulus→action policy, beyond what the non-sleeping control showed over the same period.

## The headline number (lab run 6, final budgeted run)

Subject **Conceptual Bronze Firefly** (`310283e8-6f46-401d-8a88-556f8eddbfee`), slept 84s at cascade 25. Control **Injured Crimson Turkey** (`3828a0e8-3f49-4335-8fe4-d3c4292596aa`), never slept. Same map, same food rain, 50/63 cascades respectively.

| stimulus class | subject PRE (n, H bits) | subject POST (n, H bits) | ΔH | control POST (n, H bits) | verdict |
|---|---|---|---|---|---|
| **Food in view** | 10, **1.295** [consume×6, look×3, bye×1] | 14, **0.000** [consume×14] | **−100%** | 22, **0.530** [consume×20, go×1, (no-action)×1] | **LIT** |
| peer utterance | 13, 0.773 [say×11, look×1, go×1] | 11, 1.241 [say×7, go×3, consume×1] | +60% | 13, 0.773 | no |

Criterion check (spec §7): ≥30% entropy drop ✓ (100%); below control same-period ✓ (0.000 < 0.530); n ≥ 3 in every window ✓.

## The Skill that did the work

`d4627eb2-73eb-409b-9adf-ff49e4be6fa5`, trigger_summary **"Food in view; Fountain in view"**, distilled by gpt-5.4-mini from the surviving Consolidation of the subject's own first 25 cascades. Its steps describe exactly the pre-sleep tendency: *"When food is in view, tend to choose look as an early response. When food remains in view after prior responses, tend to switch to consume."* Post-wake, every food stimulus matched it at cosine 1.000 and the ghost executed the terminal action — consume — every time.

## Matched-cascade evidence (capture log, run 6)

```
[peppers-agent] ║ ⏰ WAKE: 2 skill(s) loaded after 84s asleep
skill match: d4627eb2… sim=1.000 trigger="Food in view; Fountain in view"   (×14, cascades 36–51)
matched Food cascades   (n=14): consume×14        ← match→use 100%
unmatched Food cascades (n=10): consume×6, look×3, bye×1   (all pre-sleep)
```

Step D acceptance also met: in matched cascades the action tracks the skill's recommendation 14/14 vs 6/10 in unmatched ones.

## Honest caveats

1. **Single subject, single qualifying run.** No statistical claim — one clean demonstration.
2. **Natural concentration exists without sleep.** The control's food entropy also fell (1.275 → 0.530) — the Responses-API thread memory narrows behaviour by itself. Sleep beat that baseline (to exactly 0.000), but any future claim should always be control-adjusted, never pre/post alone.
3. **The social skill did not concentrate dialogue.** Subject's peer-utterance entropy *rose* post-sleep (0.773 → 1.241) despite 11 matched cascades. Conversation policy is context-dependent per utterance — bullet-level procedural distillation may be the wrong grain for dialogue. Left as an open question, not patched.
4. **The injection is a hint, not an override** — the 14/14 convergence is the model choosing with its own past tendency surfaced, which is the designed mechanic, but prompt-position effects weren't ablated (no run with skills loaded but injection disabled).

## What was built / fixed tonight (all inside ghosts/peppers-*)

- **Step A** — judge ensemble (`pipeline/contradict-experience.ts` + `scripts/contradict-experience.ts`): procedural-inconsistency primary + 4 claim-level judges, shared hidden-state escape hatch (`policy_dependent_variation` ≠ contradiction), stimulus-class normaliser applied to judge input. Found real policy splits in runs 1–2 ("Food in view → consume" vs "→ inspect"), zero observed false positives.
- **Step B** — `scripts/pagerank-kneedle-cut.ts`: local power-iteration PageRank (no per-blackout AGA cost) + Kneedle elbow; flat-series fallback resolves pairs mechanically (lower source_count loses, tie → older loses). Isolated consolidations never cut.
- **Step C** — `scripts/distill-skills.ts`: gpt-5.4-mini structured output against the vendored AIP schema (meta keys stripped — the model echoed the schema document otherwise), triggers mechanically grounded in observed stimulus classes, deterministic trigger_summary, clause embeddings.
- **Step D** — `peppers-agent-v2/src/cognition/skill-recall.ts` + threading through run-loop/reason-id into synthesis ("Familiarity:") and the action stage ("Remembered know-how"). `skillMatch` logged per cascade.
- **Step E** — scheduled blackout in run-house (`sleepAtCascade`, env-wired in both spawn paths), spawns the `blackout.ts` orchestrator (full chain, per-step retry after Aura blips), Fuel cost + Rest restore on wake, skill reload. Voluntary sleep (ghost-invoked tool) NOT built — scheduled-only tonight.
- **Step F** — `pipeline/entropy.ts`, `measure-stimulus-action-entropy.ts`, `measure-sleep-effect.ts`, `analyze-skill-matches.py`.

**The three defects that cost runs 1, 2 and 4 were all the same disease — lexical-space mismatch between trigger vocabulary and match-time stimuli:** (1) compound trigger summaries dilute whole-string cosine → per-clause max; (2) prose triggers ("a peer greets me") vs class strings → triggers grounded in observed classes; (3) matching used the Id-prompt stimulus grammar instead of the trace grammar → match now uses peppers-mem's `formatStimulus` (the function that writes `ReasoningTrace.task`), exported as `formatStimulusForTrace`. Run 3 was lost to a transient Aura outage (fixed with per-step retry).

## Budget spent

6/6 lab runs (~5.5h wall-clock total), ~10 dry-run LLM passes, 3 short AGA sessions (all torn down — verified empty at shutdown). Run-by-run detail in `OVERNIGHT-LOG.md`.

## Suggested next steps (not started)

- Repeat run-6 config 3–5× for control-adjusted effect size.
- Voluntary sleep tool + wake-on-say (the deferred half of Step E).
- Dialogue-grained distillation (caveat 3).
- Injection ablation (skills loaded, hint suppressed) to separate match-effect from injection-effect.
