# Per-Ghost Sleep Consolidation — Behavioural Acceptance Spec

**Audience.** A fresh Claude session running autonomously overnight. You have no memory of the design conversation; this file IS the briefing.

**Goal.** Take the partially-built sleep pipeline in `ghosts/peppers-sleep/` and drive it to the point where a single peppers ghost, after one or more **awake → sleep → awake** cycles, shows **measurably more consistent stimulus → action behaviour** than a control ghost that did not sleep. The behaviour change must be *emergent from the mechanic*, not prescribed in prompts.

You may run the lab multiple times across the night. You may rewrite the consolidation/contradiction/skill prompts. You may extend the schema as long as additive-label discipline is preserved. You may NOT commit, push, or modify git state.

---

## 1. What "the behaviour we're after" actually means

Concretely: a sleeping ghost wakes up with a small set of validated `:Skill` nodes derived from its own experience. When that ghost subsequently encounters a stimulus that matches a Skill's trigger, the matched Skill is injected into the cascade as context, and the ghost picks the action the Skill recommends more often than chance.

The end-to-end signal:

> **Same ghost, same stimulus class, post-sleep vs pre-sleep: the variance in action choice should fall.** A pre-sleep ghost responding to "Lantern in view" might emit `whoami / say / inspect / go / no-action` with rough uniformity; a post-sleep ghost should converge toward one or two preferred actions for that stimulus, *because the sleep cycle distilled the procedural pattern into a Skill that now nudges the picker*.

This is a measurable claim. Build the measurement and iterate until it lights up.

**Important — what is NOT the goal.**
- Not cross-ghost / cultural memory. Per-ghost only. The cross-ghost "Bradley-Terry voting" idea is parked.
- Not perfect policies. Some procedural patterns are legitimately context-dependent (different Fuel band, different sub-agent). The hidden-state escape hatch covers those — they should NOT be flagged as contradictions.
- Not pruning all variation. The goal is *coherent learned policies for the patterns that warrant them*, not deterministic robots.

---

## 2. State of the world right now

### What already works (validated against live Neo4j)

- **Multi-label canonical text extraction** — `src/llm/canonical-text.ts` handles `Message | ReasoningTrace | Observation | Entity | Fact`. Add new label support by extending this one file.
- **Generalised embedder** — `src/scripts/embed-experience.ts` writes `intent_embedding` (1536-d, `text-embedding-3-small`, native dim) on any subset of the five labels for any session.
- **Multi-label consolidation pipeline** — `src/scripts/try-consolidate-experience.ts` runs per-session: AGA projection → KNN → toUndirected → Leiden → per-cluster mixed-type consolidation prompt → `:Consolidation` node creation → additive relabel (`:Message` → `:ConsolidatedMessage`, etc.). Default action is dry-run; `--commit` persists.
- **Schema preservation** — `relabelMixedAsConsolidated` in `src/graph/consolidations.ts` groups members by source label and relabels per-group. Source nodes keep every original property; agent-memory's `MATCH (m:Message)` queries naturally skip relabelled nodes. This is the design contract — do not break it.
- **AGA session lifecycle** — every script that creates an AGA session tears it down in a `finally` via `deleteAgaSession`. New scripts MUST follow this pattern. AGA sessions cost real money per minute.
- **Rollback** — `src/scripts/rollback.ts` with `--keep=<session>` / `--all` / `--dry` / `--delete-aga`.
- **Lab cost-control fix shipped** — `PEPPERS_NEEDS_RUSH=0.01` keeps Fuel near setpoint so the synthesisTokenCap doesn't truncate JSON. Also there's a JSON-parse-fail safety net in `ghosts/peppers-agent-v2/src/reason-id-synthesis.ts` that returns an empty monologue rather than crashing the cascade. Both stay.
- **Contradiction prompt experiment ran** — five definitions tested in parallel against real Consolidations from ghost `de3124ab-e12a-4bc6-868d-74326646a5e9`. Winner: **`procedural-inconsistency`** (3 real / 0 FP). The four "claim-level" variants (logical-not-x, temporal-reversal, inconsistent-self-claims, mutually-exclusive-plans) correctly stayed silent because the test ghost only had inner reasoning, no dialogue. They are NOT wrong; they target patterns absent from this particular bundle.

### What is NOT yet built

- **Contradiction detector wired into the pipeline.** `src/pipeline/contradict.ts` exists for the `:Message`-only path but hasn't been generalised, and the procedural-inconsistency winner hasn't been adopted as production yet.
- **Stimulus-class normaliser** — strip `at here` / `at <cell>` / `at <direction>` qualifiers before comparing across consolidations. Synthesis agent flagged this as the #1 fix.
- **Hidden-state escape hatch** — when the two sides of a "contradiction" carry visibly different internal state (Fuel band, active sub-agent, etc.), the LLM should label it `policy-dependent variation` not `contradiction`.
- **PageRank + Kneedle cut** on the `:CONTRADICTS` graph. Survivors stay; outliers get soft-deleted via `deleteConsolidations`.
- **AIP Skill distillation.** Validated procedure schema lives in `src/aip/index.ts`. Use the larger model + structured output to turn each surviving Consolidation into an `AipProcedure`. Persist via `createSkill`.
- **Sleep state machine.** Voluntary `sleep` action exposed to the ghost. Wake conditions: `say` directed at the sleeping ghost; timeout. Micro-sleeps (short, no consolidation) vs blackouts (long, full consolidation). Fuel cost.
- **Cascade-time Skill matching.** On each new stimulus, KNN-lookup any `:Skill` nodes whose `trigger_summary` embedding is close enough. Inject as context into the Id synthesis (or earlier).
- **Sleep → consolidation cycle wiring.** When the sleep action fires, the state machine triggers `sleepOneSession` (and the rest of the pipeline) for that ghost's session.

### What you should NOT touch

- `ghosts/peppers-sleep/src/scripts/try-consolidate.ts` (the legacy `:Message`-only path). Validated and working on the original 61cd4de0 ghost. Don't refactor it; only `try-consolidate-experience.ts` is the live target.
- Anything outside `ghosts/peppers-*`. Boil discipline. The substrate edits made today (`reason-id-synthesis.ts` safety net) are exception-not-rule and were necessary to unblock the lab.

---

## 3. Build order

The order matters — each step unblocks the next.

### Step A — Make the contradiction detector live and tuned

1. Generalise `src/pipeline/contradict.ts` (or write `contradict-experience.ts`) to use the **procedural-inconsistency** prompt as the primary judge.
2. Add the **stimulus-class normaliser**: before passing two Consolidation bullets to the LLM, strip qualifiers (`at here`, `at <cell-id>`, `at <compass>`). This was the #1 improvement called out by the prior synthesis agent.
3. Add the **hidden-state escape hatch**: when calling the LLM, include any per-bullet context that indicates internal state (Fuel band, active sub-agent — see `:ReasoningTrace.metadata` for what's available). Tell the LLM that bullets carrying different state should be reported as `policy_dependent_variation`, not `contradiction`.
4. Add a **second pass** that runs the four claim-level variants (logical-not-x, temporal-reversal, inconsistent-self-claims, mutually-exclusive-plans) and UNIONs results. The synthesis agent's verdict was that production should be a small ensemble, not single-winner.
5. Write the results as `[:CONTRADICTS]` edges with `reason` text.

**Acceptance for Step A.** On a fresh `:Consolidation` set from a multi-cascade lab run, the detector produces ≥1 real contradiction AND zero of the obvious false positives (different stimuli, different sessions, different hidden-state bands).

### Step B — PageRank + Kneedle on the contradiction graph

1. Project `:Consolidation` nodes with `:CONTRADICTS` edges into AGA.
2. Run PageRank.
3. Detect the Kneedle elbow on the sorted score series.
4. Soft-delete (via `deleteConsolidations`) every node BELOW the elbow. Survivors keep their source-node relabels — that's by design, the audit trail survives even after the Consolidation itself is dropped.

**Acceptance for Step B.** Given a ghost with N consolidations and K contradictions, the cut removes the noisier consolidations and keeps the stable ones. Verify by hand-eyeballing 3 examples.

### Step C — AIP Skill distillation

1. Use the **larger** model (NOT nano) with structured output (`PROCEDURE_SCHEMA` as `response_format.json_schema`) to convert each surviving `:Consolidation` into an `AipProcedure`.
2. The skill's `trigger_summary` is the natural-language description of when this procedure should fire. Embed it (`intent_embedding` again, same 1536-d, same model).
3. `createSkill` persists it and wires `[:DISTILLED_TO]`.

**Acceptance for Step C.** Each surviving Consolidation yields exactly one valid `:Skill` (passes `quickShapeCheck`). The `trigger_summary` is short, concrete, and corresponds to the cluster's actual stimulus pattern.

### Step D — Cascade-time Skill matching

1. At cascade entry (before Id synthesis), embed the current stimulus and KNN-lookup the ghost's own `:Skill` nodes by `trigger_summary` embedding.
2. If similarity exceeds a threshold (start with cosine ≥ 0.85; tune), inject the matched Skill's procedure as a fragment into the Id's prompt. NOT as a hard override — as a hint the model can take or ignore. **Emergence, not prescription.**
3. Log every match: `{cascade_index, stimulus, matched_skill_id, similarity, action_taken}`.

**Acceptance for Step D.** A ghost with prior Skills shows match→use rate above chance, AND the action taken in matched cascades tracks the Skill's recommendation more often than in unmatched cascades.

### Step E — Sleep state machine

1. Expose a `sleep` MCP tool (lives in world-api). Voluntary action; ghost calls it when it decides to.
2. State machine: AWAKE → MICRO_SLEEP (short, returns control quickly, no consolidation) | BLACKOUT (long, runs full pipeline, then returns to AWAKE).
3. Wake by inbound `say` directed at the ghost, or by timeout.
4. Sleeping has a fuel cost (small) — sleeping ghosts still burn metabolic energy but at a reduced rate. This is the consequence/impetus pairing.
5. When BLACKOUT fires, it runs:
   ```
   embed-experience --labels=<all populated> --session=<this ghost>
   try-consolidate-experience --session=<this ghost> --commit
   embed-consolidations  (or merge into try-consolidate-experience)
   contradict-experience --session=<this ghost> --commit
   pagerank-kneedle-cut --session=<this ghost> --commit
   distill-skills --session=<this ghost> --commit
   ```
   on the ghost's own session in Neo4j. Each step has a commit/dry-run flag; only --commit mutates the graph.

**Acceptance for Step E.** A ghost can voluntarily sleep, complete the consolidation pipeline, and wake with new Skills loaded — within one lab run, observable in the cascade jsonl.

### Step F — The end-to-end behavioural test (this is the goal)

Two ghosts spawn. Both run for K cascades on the same map. One is the **control** (no sleep). One is the **subject** (sleeps at cascade K/2, then continues to K). At cascade K, measure for each ghost separately:

- Stimulus → action consistency: for each stimulus class, what's the entropy of the action distribution? Lower = more consistent.
- Specifically focus on stimulus classes that appeared ≥3 times BEFORE the sleep marker.

The behavioural acceptance criterion:

> For the subject ghost, post-sleep stimulus→action entropy drops compared to pre-sleep, AND drops below the control ghost's same-period entropy on the same stimulus classes.

If that holds, the sleep mechanic is working. If it doesn't, iterate Steps A–D (especially the procedural-inconsistency prompt + skill trigger threshold). Do NOT iterate by adding "tell the model to be consistent" — that's prescription, not emergence. Iterate by tuning the substrate's mechanical incentives: skill match threshold, distillation prompt, kneedle cut sensitivity.

---

## 4. Hard guardrails (read these every time you wake up)

These are non-negotiable. If a guardrail conflicts with progress, stop and write notes — do not violate the guardrail.

1. **NEVER commit, push, branch, reset, or stash without explicit per-action authorisation in this session.** This Claude session does NOT have authorisation; the human owns all git state mutation. Leave changes uncommitted; the human will review.
2. **Kill processes the moment data is captured.** Every minute the lab runs burns real OpenAI credit. Use `bash run_in_background:true` to launch the lab and a watcher script that exits when the target is reached; `pgrep -fla "peppers|colyseus|ghost-house|agent-host" | grep -v "monorepo\|kernel-bridge"` to verify dead. If you ever return to the human with a live process running unintentionally, that's a real failure.
3. **Boil discipline.** Edit only files under `ghosts/peppers-*` unless you have already exhausted alternatives. The exception today (substrate safety net in `reason-id-synthesis.ts`) was necessary; further substrate edits should be a last resort.
4. **Schema preservation.** Source nodes get *additive* labels only. `:Message` → also `:ConsolidatedMessage`. Properties never deleted. Edges never removed unless you're the one who added them. The agent-memory upstream `MATCH (m:Message)` query is the canary — if you've broken anything, those queries will start returning wrong-count results.
5. **Neo4j is the store.** Don't invent JSON snapshot formats, DTOs, or intermediate-representation files unless a non-Neo4j consumer truly exists.
6. **Emergence, not prescription.** Behaviours come from mechanics, not from telling the model "be consistent" or "use phrase X". Skill injection is a *hint*, not an override. The substrate's job is to surface a relevant memory; the LLM still chooses.
7. **No phrase prescription.** Skills describe BEHAVIOUR ("when a Lantern stimulus appears, prefer `inspect` over `(no-action)`"), never specific phrases ("say 'I see a lantern'").
8. **Resource depletion degrades; never compensates.** If Fuel is low, the ghost gets a shorter monologue / fewer tools. The substrate does NOT do the work for them. The 10-token synthesis floor + the new JSON-parse fallback together achieve this: the cascade still runs, but with degraded cognition.
9. **Don't strap the LLM to a calculator.** Slider/needs values should be mapped to felt-vocabulary words at the prompt boundary, never passed as raw numbers for the LLM to interpret.
10. **Mechanical impetus and consequence.** Every outcome the prompt mentions must have an actual mechanic enforcing it. No "mentioned but not enforced" constraints.
11. **End loop when idle.** If you're waiting on the human and have no concrete in-flight work, stop. Do not speculatively reschedule.
12. **End-to-end verification.** When testing behaviour, drive the FULL loop: lab launch → wait for capture → run the pipeline → measure → report. Don't claim success from unit-test green.

---

## 5. Knowledge to consult first

Open these in order before doing anything else:

1. **This file** — the spec you're reading.
2. `ghosts/peppers-sleep/README.md` if it exists; the package's design surface.
3. `ghosts/peppers-sleep/src/graph/consolidations.ts` — schema contract and additive-relabel helpers.
4. `ghosts/peppers-sleep/src/llm/canonical-text.ts` — how the five source labels map to embeddable text. The extension point for new labels.
5. `ghosts/peppers-sleep/src/scripts/try-consolidate-experience.ts` — the current end-of-pipeline script. Model new scripts on its structure.
6. `ghosts/peppers-sleep/src/scripts/rollback.ts` — your safety net. If you make a bad commit to Neo4j, this reverts it. Use `--keep=<session>` to scope rollback to non-target sessions.
7. `ghosts/peppers-sleep/src/aip/index.ts` — the AIP PROCEDURE_SCHEMA you'll feed to the larger model for Skill distillation.
8. `ghosts/peppers-agent-v2/src/reason-id-synthesis.ts` — read the safety-net comment; understand why low maxTokens can truncate JSON. Don't reintroduce the bug.

---

## 6. How to run the lab without burning the night

The lab takes credit at a measurable rate. Use this discipline:

1. Always launch with `PEPPERS_NEEDS_RUSH=0.01` (slow Fuel decay → no synthesis truncation).
2. Always archive any existing capture: `mv ghosts/peppers-agent-v2/.local/peppers-cascades.jsonl ghosts/peppers-agent-v2/.local/peppers-cascades.<run-tag>.jsonl 2>/dev/null || true`.
3. Always launch with `run_in_background: true` and pipe stdout/stderr to `/tmp/peppers-lab.log`.
4. Always launch a watcher (`bash run_in_background: true`) that polls the jsonl, exits when target reached or hard deadline hits, and writes its progress to a tasks output file. Pattern: `until <condition>; do <peek + check>; sleep 90; done`. Hard deadline `+= 14400` seconds (4 hours).
5. **Kill immediately on success.** Watcher exit → `pgrep -fla "peppers|colyseus|ghost-house|agent-host" | grep -v "monorepo\|kernel-bridge"` → `kill -9 <pids>` → re-verify clean. Confirm with `pgrep` that nothing remains.

For multi-ghost dialogue (Step F), use `--ghosts 2` or higher. Two ghosts close together will start a social cascade and produce `:Message` nodes (not just `:ReasoningTrace`).

**Budget heuristic.** A single lab run targeting one ghost at 100 cascades takes ~10 minutes wall-clock with `PEPPERS_NEEDS_RUSH=0.01`. Budget at most 4 such runs across the night for behavioural verification; the rest of the time goes to coding + small consolidation/distillation passes against existing data.

---

## 7. Verification harness — how to know it works

For the Step F behavioural acceptance, you need a measurement script. Write it. Suggested structure:

```ts
// ghosts/peppers-sleep/src/scripts/measure-stimulus-action-entropy.ts
// Input: --session=<sid> --before=<iso> --after=<iso>
// Output: per-stimulus-class action distribution + Shannon entropy,
//         for the BEFORE window and the AFTER window separately.
// Source: :ReasoningTrace rows in Neo4j for that session.
// Stimulus class = task field with the normaliser applied.
// Action = first verb in outcome field.
```

Then for Step F:

```ts
// ghosts/peppers-sleep/src/scripts/measure-sleep-effect.ts
// Two ghost sessions on the same lab run, one slept, one didn't.
// Run the entropy script for both, compute the delta.
// Print a small table per stimulus class.
```

The behavioural acceptance criterion (Step F) is met when, for at least one stimulus class that occurred ≥3 times before and after the sleep marker for the subject ghost, the subject's post-sleep entropy is meaningfully lower than its pre-sleep entropy AND lower than the control ghost's same-period entropy on that class.

Define "meaningfully lower" as: a ≥30% drop in entropy, OR a switch from "uniform across 4+ actions" to "concentrated on 1-2 actions" (qualitative).

If you can't get even one stimulus class to light up after iterating, that's a real finding — write it up in `ghosts/peppers-sleep/OVERNIGHT-FINDINGS.md` and stop the loop. Do not invent positive results.

---

## 8. Iteration discipline

If a step's acceptance fails:

1. **Read the actual data.** Open the produced Consolidations / Skills / cascade logs. Eyeball them. Most failures are visible to a human; do not skip this.
2. **Look for substrate-level fixes first**: trigger threshold, normaliser scope, mode flag, prompt clarification of WHAT counts (never WHAT to say).
3. **Only then rewrite the prompt.** When you do, run a small A/B against existing Consolidations (you don't need a fresh lab run for this — that's what the procedural-inconsistency workflow was for).
4. **Never tell the model what to do behaviourally.** Tell it what to recognise; the substrate handles consequences.
5. **Document each iteration** in `ghosts/peppers-sleep/OVERNIGHT-LOG.md` — one line per change with timestamp + what you changed + what it produced. Helps the human review in the morning.

---

## 9. When to stop

Stop and write your final report when any of these is true:

1. **Success.** Step F's behavioural acceptance criterion lights up on a real lab run. Write `OVERNIGHT-FINDINGS.md` with: which stimulus class, what the entropy drop was, the Skill that did the work, the matched-cascade log lines. Then kill everything and stop.
2. **Definite blocker.** You've identified a substrate or schema issue that needs human judgement (e.g. the agent-memory MCP shape changes, the AGA pricing model is wrong, the world doesn't expose what you need). Write a short blocker note in `OVERNIGHT-BLOCKERS.md` and stop.
3. **You've iterated three full Step-A-through-Step-F cycles without movement.** Write up what each cycle looked like and what's not improving, and stop. Do not keep burning credit on the fourth.
4. **You've spent the budget.** Set an internal cap (suggested: 6 full lab runs + ~30 dry-run consolidation passes). When you hit it, stop.

Final report goes in `ghosts/peppers-sleep/OVERNIGHT-FINDINGS.md`. Brief, scannable, with the actual numbers. The human reads this first thing.

**Don't `git add`, `git commit`, `git push`, or modify any branch / ref / stash.** Leave the working tree in whatever state it ended in. The human reviews and decides.

---

## 10. One-page summary for re-entry after auto-compaction

If your context gets compacted mid-run, re-read this section first to re-orient:

- We are building per-ghost sleep consolidation for peppers ghosts.
- The pipeline is: embed → cluster → consolidate → contradiction → cut → distill → load → match → inject.
- The behavioural goal is post-sleep entropy drop in stimulus→action mapping.
- The procedural-inconsistency prompt won the contradiction shootout — use it.
- Stimulus-class normaliser and hidden-state escape hatch are the must-add fixes.
- Lab discipline: `PEPPERS_NEEDS_RUSH=0.01`, background launch, watcher exits at target, kill on completion.
- `OVERNIGHT-LOG.md` for iteration notes. `OVERNIGHT-FINDINGS.md` for the final report.
- NO commit. NO push. Boil. Schema-preserving. Emergent. Kill processes.
- Stop on success / definite blocker / 3 full cycles without movement / budget exhausted.
