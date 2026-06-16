import type { AgentCard } from "@a2a-js/sdk";

export function buildPeppersAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "peppers-agent",
    description:
      "Two-agent (Surface + Id) personality ghost. An OCEAN-based personality drifts with each cascade; a slider-blind Surface picks world actions while an Id pipeline composes inner monologue.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      {
        id: "personality-drift",
        name: "Personality Drift",
        description: "OCEAN personality sliders drift in response to each world event.",
      },
      {
        id: "inner-monologue",
        name: "Inner Monologue",
        description: "Id pipeline composes first-person stream-of-consciousness each cascade.",
      },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "social",
      ghostClasses: ["any"],
      requiredTools: [
        "whereami", "exits", "go", "traverse", "say", "look", "look_far",
        "take", "drop", "consume", "inspect", "inventory", "whoami", "inbox", "bye",
        "request_intent", "nearest",
        // Economy (RFC-0029): buy food from a vending machine + trade with
        // peers. `request` carries the vendor purchase (the dispenser
        // auto-agrees); offer/agree/decline cover ghost-to-ghost trades.
        "request", "offer", "agree", "decline",
        // Art in the world (RFC-0031): `read` a description card's link.
        // (`inspect` — already listed — is how a ghost looks at a painting.)
        "read",
      ],
      capabilitiesRequired: [],
      memoryKind: "neo4j-agent-memory",
      llmProvider: "openai",
      profile: {
        about:
          "Two-agent personality ghost with OCEAN-based drifting traits and inner monologue.",
      },
      authors: ["@henrardo"],
    },
  } as unknown as AgentCard;
}
