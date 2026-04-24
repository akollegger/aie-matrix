import type { AgentCard } from "@a2a-js/sdk";

/** Ghost house’s own A2A discovery document (IC-005) — not the agent catalog. */
export function buildHouseAgentCard(houseBaseUrl: string): AgentCard {
  const u = houseBaseUrl.replace(/\/$/, "");
  return {
    name: "aie-matrix-ghost-house",
    description: "Ghost house: A2A host, MCP proxy, and agent catalog for aie-matrix.",
    protocolVersion: "0.3.0",
    version: "0.0.0",
    url: u,
    skills: [
      { id: "orchestrate", name: "Orchestrate", description: "Spawns and supervises contributed agents" },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
  } as AgentCard;
}
