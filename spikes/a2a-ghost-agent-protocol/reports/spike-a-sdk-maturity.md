## Executive summary

- **Recommendation:** **Proceed with changes** — `@a2a-js/sdk` **0.3.13** supports agent card resolution, synchronous `sendMessage`, `sendMessageStream`, and push notifications (`setTaskPushNotificationConfig` + `DefaultPushNotificationSender`) on Node 24 without patches.
- **Caveats:** Occasional SDK console diagnostics during simple message round-trips (`Task … not found`); treat as UX noise until confirmed with maintainers. Push path requires non-blocking `sendMessage` + explicit config registration (documented pattern).
- **Auth:** Not exercised; remains an explicit ADR open item.

## What worked

- **FR-001 / Sync:** `Client.sendMessage` returns a terminal `Message` with echoed text.
- **FR-002 / Stream:** `Client.sendMessageStream` yields task + multiple `status-update` events ending in `completed`.
- **FR-003 / Push:** Non-blocking task + `setTaskPushNotificationConfig` + local HTTP sink received POST body (~435 bytes) on task completion.
- **FR-004 / Agent card:** `ClientFactory.createFromUrl` + `getAgentCard` resolves `.well-known/agent-card.json` and matches `name: spike-a-demo-agent`.
- **Tooling:** TypeScript **5.7**, `tsx` smoke runner, `tsc` build — all green in `spike-a-sdk-exercise/`.

## What didn’t

- SDK logs warnings during smoke (non-fatal); no workaround applied beyond ignoring console noise for the spike.
- No TLS / auth / production networking tested (out of charter scope).

## What we learned (ADR / RFC deltas)

- **ADR-0004:** Evidence supports adopting `@a2a-js/sdk` for the ghost-house coordination layer for v0.3.0-style JSON-RPC; add appendix pointer to this file. Call out push pattern: **non-blocking task + push config** before completion.
- **RFC-0007:** Implementation can assume Express middleware (`jsonRpcHandler`, `agentCardHandler`) + `DefaultRequestHandler` + optional `DefaultPushNotificationSender` as the reference stack for the A2A Host component.

## Recommendation

**Proceed with changes:** merge this appendix into ADR-0004 before final acceptance; track SDK console warnings as a low-severity follow-up with `a2a-js` upstream if they persist in real workloads.
