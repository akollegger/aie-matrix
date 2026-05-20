import type { AgentCard } from "@a2a-js/sdk";

/**
 * IC-001 Listener example — no MCP movement; only receives IC-004 world events via A2A `data` parts.
 */
export function buildListenerAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "observer-agent",
    description: "TCK Listener: logs aie-matrix world-event.v1 data parts; no speech (no `say`).",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      { id: "listen", name: "Listen", description: "Log IC-004 world event envelopes" },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text", "data"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "listener",
      ghostClasses: ["any"],
      requiredTools: [],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: { about: "Observes world events only. Does not call say." },
      authors: ["@akollegger"],
    },
  } as unknown as AgentCard;
}
