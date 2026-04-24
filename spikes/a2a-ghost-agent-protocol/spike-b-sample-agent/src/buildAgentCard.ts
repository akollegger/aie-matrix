import type { AgentCard } from "@a2a-js/sdk";

export function buildSampleAgentCard(publicBase: string): AgentCard {
  const jsonRpc = `${publicBase.replace(/\/$/, "")}/a2a/jsonrpc`;
  return {
    name: "spike-b-sample-contributed",
    description: "Minimal contributed ghost for catalog + synthetic event spike",
    protocolVersion: "0.3.0",
    version: "0.0.1",
    url: jsonRpc,
    skills: [
      {
        id: "echo",
        name: "Echo",
        description: "Spawn ack and synthetic world events",
        tags: ["spike"],
      },
    ],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    mx_tier: "wanderer",
    mx_ghost_classes: ["any"],
    mx_required_tools: [],
    mx_capabilities_required: [],
    mx_memory_kind: "none",
    mx_llm_provider: "none",
    mx_profile: { about: "Spike B sample — no LLM" },
    mx_authors: ["@spike-b"],
  } as unknown as AgentCard;
}
