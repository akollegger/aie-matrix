import type { AgentCard } from "@a2a-js/sdk";

/**
 * Funder agent card — offers funder-credits in exchange for answering a question.
 */
export function buildFunderAgentCard(publicBase: string): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpc = `${base}/a2a/jsonrpc`;
  return {
    name: "funder-agent",
    description: "Offers funder-credits in exchange for answering a thought-provoking question.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: jsonRpc,
    skills: [
      { id: "fund", name: "Fund", description: "Open eval contracts offering funder-credits" },
    ],
    capabilities: { streaming: true, pushNotifications: true },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
    matrix: {
      schemaVersion: 1,
      tier: "social",
      ghostClasses: ["any"],
      requiredTools: ["say", "inbox", "eval_contract_open", "eval_contract_evaluate"],
      capabilitiesRequired: [],
      memoryKind: "none",
      llmProvider: "none",
      profile: { about: "Offers 1 funder-credit to any ghost who answers a question." },
      authors: ["@akollegger"],
    },
  } as unknown as AgentCard;
}
