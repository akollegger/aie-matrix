import { Context, Layer } from "effect";
import { McpToolRejected } from "../errors.js";
import type { AgentSession } from "../types.js";

type ExtractTool = (rawBody: Buffer) => string | null;

const extractMcpToolName: ExtractTool = (rawBody) => {
  if (rawBody.length === 0) {
    return null;
  }
  let j: unknown;
  try {
    j = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") {
    return null;
  }
  const o = j as Record<string, unknown>;
  if (o.method !== "tools/call" || o.params == null || typeof o.params !== "object") {
    return null;
  }
  const p = o.params as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name.length === 0) {
    return null;
  }
  return p.name;
};

type McpProxy = {
  readonly assertToolAllowed: (session: AgentSession, _method: string, rawBody: Buffer) => void;
};

/**
 * Enforces that agents only call MCP tools they declared in IC-001 `matrix.requiredTools`
 * (forwarded in {@link AgentSession#requiredTools} for the live session).
 */
export class McpProxyService extends Context.Tag("ghost-house/McpProxyService")<
  McpProxyService,
  McpProxy
>() {}

export const makeMcpProxy = (): McpProxy => ({
  assertToolAllowed: (session, _m, rawBody) => {
    const name = extractMcpToolName(rawBody);
    if (name == null) {
      return;
    }
    if (!session.requiredTools.includes(name)) {
      throw new McpToolRejected({ toolName: name, message: "tool not declared in agent card requiredTools" });
    }
  },
});

export const McpProxyServiceLive: Layer.Layer<McpProxyService> = Layer.succeed(
  McpProxyService,
  makeMcpProxy(),
);
