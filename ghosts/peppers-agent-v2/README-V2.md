# peppers-agent-v2 — Id-as-mind, Surface-as-voice

A reframe of peppers cognition. The Id becomes a multi-agent system with tools (OpenAI Agents SDK); the Surface becomes a stateful voice (OpenAI Responses API direct).

**Status: sketch.** Every LLM-touching function throws `not wired (v2 sketch)`. The architecture is reviewable as code; the substance comes with the wiring pass.

## Architecture in one diagram

```
                            ┌─────────────────────────┐
              cascade tick  │  cascade-orchestrator    │
                            │  (thin per-tick loop)    │
                            └────────────┬────────────┘
                                         │ stimulus + felt context
                                         ▼
                            ┌─────────────────────────┐
                            │       Id agent           │
                            │  (OpenAI Agents SDK)     │
                            │   reads Internal sliders │
                            └────┬───────┬───────┬────┘
                       handoff   │       │       │
            ┌────────────────────┘       │       └─────────────────┐
            ▼                            ▼                          ▼
       fuel-manager              social-engager                rest-manager
       (drive sub-agent)          (drive sub-agent)             (drive sub-agent)
                                                                  + curiosity

                              │ tool calls
                              ▼
        ┌──────────────────────────────────────────────────────┐
        │                                                       │
        │   memory tools         world tools      voice tool   │
        │   (gated by substrate) (perception +    (calls       │
        │                         action via       Surface)    │
        │                         MCP)                          │
        │                                                       │
        └──────────────────────────────────────────────────────┘
                              │
                              ▼ speak(intent)
                            ┌─────────────────────────┐
                            │     Surface agent        │
                            │  (OpenAI Responses API)  │
                            │  reads External sliders  │
                            │  per-ghost stateful      │
                            │  thread                  │
                            └─────────────────────────┘
```

## Key design choices

### 1. Id is the executive; Surface is the voice

The Id picks ACTIONS. The Surface produces SPEECH from intents the Id supplies. This inverts v1, where the Surface was both decision-maker and speaker. The split lets the Surface specialise (long, stateful voice thread; small tool set) and lets the Id specialise (multi-agent, tool-heavy, action-oriented).

### 2. Memory is pulled, not pushed

v1 prefetched a Memory timeline block (dialogue + actions + impressions) into every cascade's prompt. v2 hands the Id memory tools and trusts it to query adaptively. Tokens flow to the questions the agent actually asks; the prompt doesn't pre-load context the agent might not need.

### 3. Internal vs External slider split

- **Id reads Internal sliders only** (Honesty, Modesty, Anxiety, Conscientiousness — the truth of the ghost).
- **Surface reads External sliders only** (Warmth, Assertiveness, Activity, Liberalism — the performance of the ghost).
- When the two diverge, the **crack in the mask** is mechanically present and observable: e.g. the Id hoards food while the Surface says "I'd love to share." This is the architectural payoff for the previously-unmechanised Internal/External distinction.

### 4. Memory gating by cognitive state

The substrate gates what memory tools can return based on body/mind state. The agent always decides what to ASK; the substrate decides what's REACHABLE.

- Low Fuel → recency horizon collapses; older memories return as "fog."
- Low Coherence → cross-references blocked; can recall single facts but not webs.
- Low Rest → short-term capacity shrinks toward zero.
- Pathology states (extensible) → biased availability:
  - `depression` → only negative-valence memories accessible.
  - `dementia` → no short-term recall at all.
  - `grief` → recall loops on the immediate past.

See `src/memory-tools.ts:computeMemoryAvailability`.

### 5. Felt-duration translation

The agent never sees cascade numbers. Every tool that mentions time translates the substrate counter to vocabulary: "just now," "a moment ago," "earlier," "a while back," "some time ago," "a long time ago," or "you can't quite remember when." Single source of truth: `src/time-tools.ts:feltDurationFromGap`.

### 6. OCEAN facet mechanics preserved from v1

The Impulse → Facets → Convergence pipeline from peppers-inner is NOT replaced. Slider drift still happens deterministically post-cascade based on what happened. The Id agent's job is decision-making, not drift accounting; drift is substrate work. Drive sub-agents are an additional layer (action specialists), not a replacement for facets.

## File layout

```
src/
├── agent-sdk-types.ts        Placeholder types for @openai/agents (swap on wiring)
├── id-agent.ts               Id parent agent factory + per-cascade build
├── instructions.ts           Id instructions template (identity baked in)
├── surface-agent.ts          Surface voice agent (Responses API direct)
├── memory-tools.ts           ★ Substrate-gated memory primitives
├── time-tools.ts             ★ Felt-duration translation
├── world-tools.ts            Perception + action tool surface
├── substrate-readout.ts      read_drives, read_self_state, mark_now
├── voice-tool.ts             speak + end_conversation (Id calls these)
├── cascade-orchestrator.ts   Per-cascade loop manager (thin)
├── agent.ts                  A2A server entry (stub — fails loud)
├── index.ts                  Package exports
└── sub-agents/
    ├── fuel-manager.ts       Drive sub-agent: hunger / foraging
    ├── social-engager.ts     Drive sub-agent: cluster interaction
    ├── rest-manager.ts       Drive sub-agent: fatigue / recovery
    └── curiosity.ts          Default sub-agent: wandering / exploration
```

★ marks the architectural innovations specific to v2.

## What's wired vs stubbed

**Wired (you can read and reason about the substance):**

- All type surfaces
- Memory availability computation (`computeMemoryAvailability`)
- Felt-duration vocabulary mapping (`feltDurationFromGap`)
- All instructions templates
- Sub-agent instructions per drive
- Surface voice rules (`SURFACE_VOICE_RULES`)
- File-level imports and exports

**Stubbed (throws `not wired` until the wiring pass):**

- Every tool handler dispatches via `throw new Error("X: not wired")`.
- `callSurface` (will call OpenAI Responses API).
- `runAgent` (placeholder for `@openai/agents`' real runner).
- `runCascade` (the orchestrator's per-tick body).
- `agent.ts` (A2A server — exits with a loud message).

## Wiring checklist (next pass)

1. **Install `@openai/agents`.** Replace `agent-sdk-types.ts` imports throughout with real SDK imports. Verify the SDK's `tool()` / `Agent` / `Runner` shapes match the local placeholders; adjust if not.
2. **Wire memory-tools.ts handlers** to dispatch to `peppers-mem` (the same package v2 depends on today). Each handler:
   - Computes `MemoryAvailability` from current substrate state via `deps.readGateState(ctx)`.
   - Calls the appropriate `peppers-mem` retrieval function.
   - Truncates / fogs results per the availability decision.
   - Returns a narrative-shaped `MemoryRecall<T>`.
3. **Wire world-tools.ts handlers** to dispatch to `GhostMcpClient` (from `@aie-matrix/ghost-ts-client`). Same client v1 uses. Translate result shapes to the v2 felt-language types.
4. **Wire substrate-readout.ts handlers** to peppers-inner's slider / drive / commitment readout functions. Add a `mark_now` write path (new addition to peppers-mem — write a labelled Fact at the current cascade).
5. **Wire voice-tool.ts handlers** to dispatch via a `SurfaceDispatcher` that the orchestrator holds per ghost. Each `speak` call: builds `SurfaceCallInput`, calls `callSurface`, submits result text via world `say`, returns delivery confirmation.
6. **Wire surface-agent.ts `callSurface`** to OpenAI `responses.create({ model, instructions, input, previous_response_id })`. Hold `previous_response_id` per ghost in `SurfaceThreadState`.
7. **Wire cascade-orchestrator.ts `runCascade`** to the per-tick body described in its TODO. Reuse v1's poll-stimulus logic (no LLM there; pure perception) but route the result to `runAgent(idAgent, ...)` instead of v1's bespoke pipeline.
8. **Wire agent.ts** to the real A2A server, with the v2 cascade-orchestrator inside the spawn handler.
9. **Add `peppers:demo:v2`** root script that mirrors `peppers:demo` but spawns this package. (Lab launcher already accepts `--variant v2`.)
10. **Smoke-test** with one ghost on a simple map. Confirm that:
    - The Id receives a stimulus.
    - It calls memory tools and gets gated results.
    - It calls world tools.
    - It hands off to a sub-agent when a drive escalates.
    - Speaking invokes the Surface and produces text.
    - The substrate drifts as expected post-cascade.

## Open questions for tuning (after wiring)

- **OCEAN drift convergence in v2.** The user's planned three-input pipeline (primal drives + LLM impressions of previous response + memory) needs implementation here. Likely shape: a deterministic `applyOceanDrift(prevState, cascadeEvents) → newState` function in peppers-inner, called by the orchestrator post-cascade. No new LLM call required — the convergence math is mechanical.
- **Sub-agent activation thresholds.** When does the Id hand off to a drive sub-agent vs. handle it itself? Current sketch leaves this to the Id's judgment via instructions; we may want explicit substrate triggers.
- **Memory-gate calibration.** The recency-horizon formula (`Fuel × 12`) is a guess. Real values come from running the lab and observing degradation behavior.
- **Surface latency.** Each `speak` call is a separate Responses API request. For verbose ghosts this could add real latency. Caching the Surface's system + voice rules helps; if it's still slow we may batch multiple speak intents per cascade.
- **Pathology state introduction.** The framework supports `depression`/`dementia`/`mania`/`grief` but no substrate triggers them yet. Adding them is a peppers-inner change, not a v2 change.
