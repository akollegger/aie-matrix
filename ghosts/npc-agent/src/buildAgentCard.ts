import type { AgentCard } from "@a2a-js/sdk";

/**
 * NPC agent card — pushNotifications:true, llmProvider:none, subscribes to world events (IC-005).
 */
export function buildNpcAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "npc-agent",
    description:
      "Rule-based NPC agent that populates a session with catalog characters. No LLM required.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      {
        id: "roster-spawn",
        name: "Roster Spawn",
        description: "Spawns all enabled catalog characters when a session starts",
      },
      {
        id: "rule-behavior",
        name: "Rule Behavior",
        description: "Each character follows a priority-ordered behavior rule table",
      },
      {
        id: "dialog-tree",
        name: "Dialog Tree",
        description: "Characters respond to messages via a scripted dialog tree",
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
      requiredTools: ["whereami", "exits", "go", "say", "inventory", "take"],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: {
        about: "Deterministic NPC characters driven by rule tables and dialog trees.",
      },
      worldEventSubscriptions: ["world.session.start", "world.message.new"],
      authors: ["@akollegger"],
    },
  } as unknown as AgentCard;
}
