import type { AgentCard } from "@a2a-js/sdk";

/**
 * RDC agent A2A card.
 *
 * Declares the same baseline skills as peppers (the social cascade is
 * delegated to peppers internally) AND the RDC-specific skills:
 *   - poker-play
 *   - bounty-place / bounty-claim
 *
 * The orchestrator queries this card to gate invitations: an agent
 * whose card lacks `poker-play` never gets dealt in. That's how
 * "only RDCs can play poker" is enforced for v1, before server-side
 * capability gating lands.
 */
export function buildRdcAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "rdc-agent",
    description:
      "Wild West outlaw or marshall ghost. Wraps the peppers personality cascade for social mode and adds a slider-aware poker brain for game mode. Plays real Texas Hold'em hands at saloon tables; can place and claim bounties.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      {
        id: "personality-drift",
        name: "Personality Drift",
        description: "OCEAN-style sliders drift in response to lived experience.",
      },
      {
        id: "inner-monologue",
        name: "Inner Monologue",
        description: "Stream-of-consciousness composed every cascade.",
      },
      {
        id: "poker-play",
        name: "Poker Play",
        description:
          "Plays Texas Hold'em hands at saloon tables. Decisions are inflected by the agent's current slider profile (aggression, tightness, bluff frequency, tilt susceptibility).",
      },
      {
        id: "bounty-place",
        name: "Place Bounty",
        description:
          "Places a Cyphers bounty on another ghost via the RDC ledger.",
      },
      {
        id: "bounty-claim",
        name: "Claim Bounty",
        description:
          "Claims a bounty on a target ghost (resolution mechanism out-of-scope for v1; placement is enforced).",
      },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "social",
      ghostClasses: ["rdc"],
      // Tools the peppers cascade actually calls via MCP. `inbox` is
      // essential — peppers polls it for whispers from other ghosts; if
      // it's missing, the MCP proxy rejects every inbox poll and the
      // ghost is socially deaf.
      requiredTools: [
        "whereami",
        "exits",
        "go",
        "say",
        "look",
        "take",
        "drop",
        "inspect",
        "inventory",
        "inbox",
        "bye",
      ],
      // House-side capabilities are world/infrastructure features (e.g.
      // `telemetry.otlp`). `poker-play` is a *skill* the agent provides,
      // already declared in `skills` above — it doesn't belong here.
      capabilitiesRequired: [],
      memoryKind: "neo4j-agent-memory",
      llmProvider: "openai",
      profile: {
        about:
          "RDC ghost — wild-west personality wrapped around the peppers cascade pipeline. Plays poker for Cyphers, the saloon's in-world token.",
      },
      authors: ["@henrardo"],
    },
  } as unknown as AgentCard;
}
