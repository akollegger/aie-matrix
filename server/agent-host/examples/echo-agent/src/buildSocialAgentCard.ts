import type { AgentCard } from "@a2a-js/sdk";

/** IC-001 Social: receives push + emits speech via MCP `say` through the house. */
export function buildSocialEchoAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "echo-agent",
    description: "TCK Social: echoes world.message.new text via MCP say.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      { id: "echo", name: "Echo", description: "MCP say with received message text" },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text", "data"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "social",
      ghostClasses: ["any"],
      requiredTools: ["whereami", "say"],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: { about: "Echoes inbound world messages using MCP say." },
      authors: ["@akollegger"],
    },
  } as unknown as AgentCard;
}
