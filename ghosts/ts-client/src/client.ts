import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  SayArgs, SayResult,
  ByeResult,
  InboxResult,
  WhoAmIResult,
  WhereAmIResult,
  ExitsResult,
  LookArgs, LookResult,
  GoArgs, GoResult,
  TakeArgs, TakeResult,
  DropArgs, DropResult,
  InventoryResult,
  TraverseResult,
} from "@aie-matrix/shared-types";

/** One observed MCP tool call — fired AFTER the call resolves. */
export interface ToolCallObservation {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly at: string;
  readonly durationMs: number;
  readonly result: unknown;
  readonly error: string | null;
}

export interface GhostMcpClientOptions {
  /** Streamable HTTP MCP endpoint (e.g. `http://127.0.0.1:8787/mcp`). */
  worldApiBaseUrl: string;
  /** Ghost session JWT from registry adoption. */
  token: string;
  /** Optional observer fired after every callTool resolves. Errors
   *  thrown by the observer are swallowed. */
  onToolCall?: (obs: ToolCallObservation) => void;
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

  async whoami(): Promise<WhoAmIResult> {
    return (await this.callTool("whoami")) as WhoAmIResult;
  }

  async whereami(): Promise<WhereAmIResult> {
    return (await this.callTool("whereami")) as WhereAmIResult;
  }

  async exits(): Promise<ExitsResult> {
    return (await this.callTool("exits")) as ExitsResult;
  }

  async look(args: LookArgs = {}): Promise<LookResult> {
    return (await this.callTool("look", args as unknown as Record<string, unknown>)) as LookResult;
  }

  async go(args: GoArgs): Promise<GoResult> {
    return (await this.callTool("go", args as unknown as Record<string, unknown>)) as GoResult;
  }

  async take(args: TakeArgs): Promise<TakeResult> {
    return (await this.callTool("take", args as unknown as Record<string, unknown>)) as TakeResult;
  }

  async drop(args: DropArgs): Promise<DropResult> {
    return (await this.callTool("drop", args as unknown as unknown as Record<string, unknown>)) as DropResult;
  }

  async inventory(): Promise<InventoryResult> {
    return (await this.callTool("inventory")) as InventoryResult;
  }

  async traverse(args: { via: string }): Promise<TraverseResult> {
    return (await this.callTool("traverse", args as unknown as Record<string, unknown>)) as TraverseResult;
  }

  async say(args: SayArgs): Promise<SayResult> {
    return (await this.callTool("say", args as unknown as unknown as Record<string, unknown>)) as SayResult;
  }

  async bye(): Promise<ByeResult> {
    return (await this.callTool("bye")) as ByeResult;
  }

  async inbox(): Promise<InboxResult> {
    return (await this.callTool("inbox")) as InboxResult;
  }

  /**
   * List the MCP tools the server actually exposes — the authoritative
   * runtime menu. Used by the agent to discover what's possible without
   * the prompt having to enumerate tools by name.
   */
  async listTools(): Promise<ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
  }>> {
    if (!this.client) {
      throw new Error("GhostMcpClient is not connected");
    }
    const result = await this.client.listTools();
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));
  }

  async callTool(name: string, arguments_: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) {
      throw new Error("GhostMcpClient is not connected");
    }
    const startedAt = Date.now();
    let parsed: unknown = null;
    let errorText: string | null = null;
    try {
      const result = (await this.client.callTool({
        name,
        arguments: arguments_,
      })) as CallToolResult;
      if (result.isError) {
        const first = Array.isArray(result.content) ? result.content[0] : undefined;
        const text =
          first && first.type === "text" && "text" in first ? first.text : JSON.stringify(result);
        errorText = text;
        throw new Error(text);
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.find((c) => c.type === "text" && "text" in c) as
        | { type: "text"; text: string }
        | undefined;
      if (!text) {
        parsed = result;
        return result;
      }
      try {
        parsed = JSON.parse(text.text) as unknown;
      } catch {
        parsed = text.text;
      }
      return parsed;
    } catch (err) {
      if (errorText === null) {
        errorText = err instanceof Error ? err.message : String(err);
      }
      throw err;
    } finally {
      if (this.options.onToolCall) {
        try {
          this.options.onToolCall({
            name,
            arguments: arguments_,
            at: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            result: errorText === null ? parsed : null,
            error: errorText,
          });
        } catch {
          /* observer must never break a tool call */
        }
      }
    }
  }
}
