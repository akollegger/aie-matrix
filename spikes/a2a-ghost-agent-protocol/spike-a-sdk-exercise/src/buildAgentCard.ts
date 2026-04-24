import type { AgentCard } from "@a2a-js/sdk";

/** Public base e.g. http://127.0.0.1:4710 — JSON-RPC mounted at /a2a/jsonrpc */
export function buildAgentCard(publicBase: string): AgentCard {
  const jsonRpc = `${publicBase.replace(/\/$/, "")}/a2a/jsonrpc`;
  return {
    name: "spike-a-demo-agent",
    description: "008 spike — exercises sync, stream, push, and agent card",
    protocolVersion: "0.3.0",
    version: "0.0.1",
    url: jsonRpc,
    skills: [
      {
        id: "demo",
        name: "Demo",
        description: "Responds to sync-ping, stream-demo, push-demo",
        tags: ["spike"],
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [{ url: jsonRpc, transport: "JSONRPC" }],
  };
}
