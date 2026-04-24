import type { AgentCard } from "@a2a-js/sdk";

/**
 * IC-001 Wanderer reference card — `url` and JSON-RPC path must match {@link startAgent} wiring.
 */
export function buildWandererAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "random-agent",
    description: "Reference Wanderer agent: random movement, no memory, no speech.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      { id: "wander", name: "Wander", description: "Move to a random adjacent cell each tick" },
    ],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "wanderer",
      ghostClasses: ["any"],
      requiredTools: ["whereami", "exits", "go"],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: { about: "The simplest possible ghost. Moves at random, never speaks, never listens." },
      authors: ["@akollegger"],
    },
  } as unknown as AgentCard;
}
