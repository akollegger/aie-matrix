# RFC-0014: Server-side capability gating for ghost classes

| Status | Draft |
|--------|-------|
| Author | Claude (drafted during 2026-05-07 RDC spike, reviewed by @henrardo) |
| Discussion | _open_ |

## Summary

The RDC v1 implementation enforces "only RDC ghosts can play poker" in the **orchestrator**: agents whose A2A card lacks the `poker-play` capability never get invited. This works for cooperative agents but isn't authoritative — a peppers agent that calls `POST /tables/start` directly with the right token would be seated.

This RFC proposes moving capability gating into the **world-api** itself, so Saloon-tile-bound mini-game tools (poker, duel, bounty-claim) are denied at the MCP-tool dispatch layer when the calling ghost lacks the declared capability on its registered card.

## Motivation

- **Authoritative enforcement**: orchestrator-side gating is convention; server-side is constraint.
- **Decoupled mini-game services**: a future `rdc-duels` service shouldn't have to re-implement the gating; the world-api already knows who can do what.
- **Cross-house safety**: as more ghost-house types come online, the rule "only RDCs can do RDC things" will be repeated everywhere unless centralised.

## Design

### Capability claims on the agent card

Today's `matrix` extension on the agent card lists `capabilitiesRequired` — what an agent *needs*. Add a parallel `capabilitiesProvided` field — what the agent *offers*. RDC agents declare:

```jsonc
"matrix": {
  "ghostClasses": ["rdc"],
  "capabilitiesProvided": ["poker-play", "bounty-place", "bounty-claim", "duel"],
  ...
}
```

These are surfaced via the registry's existing `/registry/ghosts/:id` endpoint when the registry indexes the agent card on adoption.

### Tool-dispatch gating in world-api

Mini-game services define their tool schemas. Each tool lists a `requiredCapability`:

```ts
server.registerTool("rdc.poker.join", {
  description: "Join a poker table at the current saloon tile.",
  requiredCapability: "poker-play",  // NEW
  inputSchema: { tableId: z.string() },
}, ...)
```

The MCP server's pre-dispatch hook reads the calling ghost's `capabilitiesProvided` set from its registry record. If the tool's `requiredCapability` isn't present, the call is rejected with a structured `CAPABILITY_DENIED` error. The agent's brain then knows "you can't do that" deterministically rather than via fuzzy LLM behaviour.

### Migration path

1. **Phase 1 (this RFC implementation)**: add `capabilitiesProvided` to agent cards; surface via registry; orchestrators read it as advisory.
2. **Phase 2**: world-api enforces on a per-tool basis. RDC mini-game tools (poker, duel, bounty-claim) ship with `requiredCapability` declarations. Existing tools (whoami, look, etc.) stay open.
3. **Phase 3**: tools with implicit class restrictions today get `requiredCapability` retrofitted — e.g., bounty-place might require `rdc-citizen` if the design wants peppers ghosts to read bounties but not place them.

## Open questions

1. **Capability namespace** — flat strings (`poker-play`)? Or namespaced (`rdc:poker:play`) for collision avoidance as more houses come online?
2. **Registry as source of truth** — capabilities are declared on the agent card and indexed on adoption. If an agent updates its card mid-life, does the registry re-fetch? (Probably yes, on heartbeat.)
3. **Default-deny vs default-allow** — tools without `requiredCapability` are default-allow. Should there be a "private" tool category that's default-deny unless explicitly granted?

## Impact

- New optional field on agent cards (`capabilitiesProvided`), backwards-compatible.
- Registry change: index `capabilitiesProvided` on adoption; expose on get-ghost.
- World-api change: pre-dispatch hook reads capabilities, rejects `CAPABILITY_DENIED` when required-but-missing.
- All RDC packages stay unchanged — they already declare `capabilitiesRequired: ["poker-play"]` on their card.

No client-side changes (the orchestrator's invite-filter logic becomes redundant but harmless).
