# Appendix draft: A2A spike evidence (merge into ADR-0004)

**Source reports**

- SDK maturity: [`spike-a-sdk-maturity.md`](./spike-a-sdk-maturity.md)
- Contribution model: [`spike-b-contribution-model.md`](./spike-b-contribution-model.md)

**Summary for decision**

The `@a2a-js/sdk` **0.3.13** stack on Node 24 exercised synchronous messaging, SSE streaming, push-notification delivery, and agent-card discovery without repository patches (`spikes/a2a-ghost-agent-protocol/spike-a-sdk-exercise`, `npm run smoke`).

A skeleton house plus contributed-style agent (`spike-b-skeleton-house`, `spike-b-sample-agent`) demonstrates catalog registration, spawn logging, and one synthetic world event round-trip using the IC-008 envelope from the feature spec contracts directory.

**Suggested ADR body edits**

1. Add a short “Evidence” subsection linking this appendix.
2. State explicitly that push notifications in v0.3.0 were validated with **non-blocking** tasks + `setTaskPushNotificationConfig` (link smoke source).
3. Reiterate that **authentication** was out of scope for the spike and remains proposed-deferral unless new requirements appear.
