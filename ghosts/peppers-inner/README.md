# peppers-inner

Pure logic for the Peppers Ghost architecture. No I/O, no LLM calls, no network — just slider math, facet types, event/cascade builders. Tested in isolation with `pnpm --filter @aie-matrix/ghost-peppers-inner test`.

## Exports

- **Sliders**: `applyDelta`, `toDisplay`, `fromDisplay`, `midpoint`, `DEFAULT_DELTA`, `DISPLAY_MIN`/`DISPLAY_MAX`/`DISPLAY_MIDPOINT`. Logit-space storage, sigmoid display, diminishing-returns deltas.
- **Facets**: `STARTER_FACETS` (Ideas, Deliberation, Assertiveness, Warmth, Trust, Altruism, Stability, Self-Monitoring), `midpointPersonality`, `samplePersonality`, types `FacetName` / `TraitState` / `PersonalityState`.
- **Adjustments**: `Adjustment` and `AppliedAdjustment` value types. The strict ≥1-up + ≥1-down validator was retired with the modular Id pipeline — each facet agent now owns its own slider; apply via `applyDelta` per facet.
- **Events**: `Stimulus`, `SurfaceAction`, `ActionOutcome`, plus `createExternalStimulusEvent` / `createIdAdjustmentEvent` / `createIdThoughtEvent` / `createSurfaceActionEvent` for cascade construction.
- **Cascade**: `CascadeBuilder` for building a `CascadeTrace` from a trigger + steps; consumed by `peppers-mem`'s `persistCascade`.

## Where this fits

See [`peppers-house/README.md`](../peppers-house/README.md) for the end-to-end architecture. This package is pure data and pure functions — everything stateful lives in `peppers-house`, everything persistent in `peppers-mem`.
