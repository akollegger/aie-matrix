import type { AgentCard } from "@a2a-js/sdk";

/**
 * IC-001 Wanderer reference card — `url` and JSON-RPC path must match {@link startAgent} wiring.
 */
export function buildWandererAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "random-agent",
    description: "Wanderer ghost that moves at random and echoes messages from human partners.",
    protocolVersion: "0.3.0",
    version: "0.2.0",
    url: jsonRpc,
    skills: [
      { id: "wander", name: "Wander", description: "Move to a random adjacent cell each tick" },
      { id: "partner-reply", name: "Partner Reply", description: "Echo messages from a human partner" },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "social",
      ghostClasses: ["any"],
      requiredTools: ["whereami", "exits", "go", "say"],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: { about: "Moves at random and echoes messages from human partners." },
      authors: ["@akollegger"],
    },
  } as unknown as AgentCard;
}
