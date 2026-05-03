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
        "whereami", "exits", "go", "say", "look",
        "take", "drop", "inspect", "inventory", "whoami", "bye",
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
