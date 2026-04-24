import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SayResult, ByeResult, InboxResult } from "@aie-matrix/shared-types";

export interface GhostMcpClientOptions {
  /** Streamable HTTP MCP endpoint (e.g. `http://127.0.0.1:8787/mcp`). */
  worldApiBaseUrl: string;
  /** Ghost session JWT from registry adoption. */
  token: string;
}

/**
 * Thin MCP Streamable HTTP client for ghost runtimes (research.md transport default).
 */
export class GhostMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(private readonly options: GhostMcpClientOptions) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    const client = new Client(
      { name: "@aie-matrix/ghost-ts-client", version: "0.0.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.options.worldApiBaseUrl), {
      requestInit: {
        headers: {
          // Streamable HTTP server rejects requests that do not advertise both content types.
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${this.options.token}`,
          // Avoid HTTP keep-alive issues with some Node / MCP Streamable HTTP stacks (ECONNRESET on follow-up POSTs).
          Connection: "close",
        },
      },
    });
    await client.connect(transport);
    this.client = client;
    this.transport = transport;
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
    this.transport = null;
    this.client = null;
  }

  async say(content: string): Promise<SayResult> {
    return (await this.callTool("say", { content })) as SayResult;
  }

  async bye(): Promise<ByeResult> {
    return (await this.callTool("bye")) as ByeResult;
  }

  async inbox(): Promise<InboxResult> {
    return (await this.callTool("inbox")) as InboxResult;
  }

  async callTool(name: string, arguments_: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) {
      throw new Error("GhostMcpClient is not connected");
    }
    const result = (await this.client.callTool({
      name,
      arguments: arguments_,
    })) as CallToolResult;
    if (result.isError) {
      const first = Array.isArray(result.content) ? result.content[0] : undefined;
      const text =
        first && first.type === "text" && "text" in first ? first.text : JSON.stringify(result);
      throw new Error(text);
    }
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((c) => c.type === "text" && "text" in c) as
      | { type: "text"; text: string }
      | undefined;
    if (!text) {
      return result;
    }
    try {
      return JSON.parse(text.text) as unknown;
    } catch {
      return text.text;
    }
  }
}
