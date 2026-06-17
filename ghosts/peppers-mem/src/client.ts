/**
 * Thin typed wrapper around the Neo4j Agent Memory MCP server.
 *
 * The Agent Memory package is Python-only; we consume it via its MCP
 * stdio surface, spawned as a uvx subprocess. This keeps our TS code
 * protocol-clean: we hold an MCP `Client`, list its tools, and invoke
 * them by name. Nothing in this file is specific to the Agent Memory
 * tool surface — that lives in the smoke script and (later) the house
 * runner.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/** Connection parameters for the ghost-minds Neo4j (PeppersGhosts in dev). */
export interface MemoryConnection {
  readonly uri: string;
  readonly username: string;
  readonly password: string;
  /** Defaults to "neo4j" if omitted — matches the Agent Memory CLI default. */
  readonly database?: string;
}

/** Options for connecting to the Agent Memory MCP server.
 *
 * Two transports, selected by config (production picks the service URL;
 * the stdio path stays for local dev with no service running):
 *
 *   - serviceUrl set (or PEPPERS_MEMORY_MCP_URL env) → connect over SSE
 *     to a shared, multi-tenant agent-memory service (the k8s-scalable
 *     production shape). No subprocess; memory is its own deployable.
 *   - else → spawn the package as a uvx stdio subprocess (local dev).
 *     Requires `connection` (Neo4j creds for the subprocess).
 */
export interface MemoryClientOptions {
  /** SSE endpoint of a running agent-memory service, e.g.
   *  `http://agent-memory:8080/sse`. Overrides the stdio path.
   *  Falls back to PEPPERS_MEMORY_MCP_URL when omitted. */
  readonly serviceUrl?: string;
  /** Neo4j connection — required only for the stdio (local) path; the
   *  SSE service owns its own Neo4j connection. */
  readonly connection?: MemoryConnection;
  /**
   * "core" (6 tools, lower context overhead) or "extended" (16 tools,
   * includes reasoning-trace tools and `graph_query` for direct
   * Cypher reads). stdio path only; the service is configured server-side.
   */
  readonly profile?: "core" | "extended";
  /**
   * Optional override for the uvx invocation (stdio path only). Defaults
   * to the upstream package coordinates.
   */
  readonly uvxArgs?: readonly string[];
}

/** A connected Agent Memory MCP client + the subprocess transport that backs it. */
export interface MemoryClientHandle {
  readonly client: Client;
  /** Closes both the MCP client and the underlying subprocess. */
  close(): Promise<void>;
}

const DEFAULT_UVX_ARGS: readonly string[] = [
  "--from",
  "neo4j-agent-memory[openai,mcp]",
  "neo4j-agent-memory",
  "mcp",
  "serve",
  "--transport",
  "stdio",
];

/**
 * Spawn the Agent Memory MCP server as a child process and connect to
 * it over stdio. The returned handle exposes the MCP `Client` directly;
 * call `close()` when you're done to terminate the subprocess.
 */
export async function connectMemory(opts: MemoryClientOptions): Promise<MemoryClientHandle> {
  // Default to extended: includes memory_start_trace / memory_record_step /
  // memory_complete_trace (which the core profile omits) and graph_query for
  // direct Cypher reads. Required by persistCascade.
  const { connection, profile = "extended" } = opts;

  // ── Production path: connect to a shared agent-memory SSE service ──────────
  // The service is its own k8s-scalable deployable, multi-tenant by
  // session_id, owning its own Neo4j connection. peppers just holds an
  // MCP Client over SSE — no subprocess, no Python in this image.
  const serviceUrl = opts.serviceUrl ?? process.env.PEPPERS_MEMORY_MCP_URL;
  if (serviceUrl !== undefined && serviceUrl.length > 0) {
    const transport = new SSEClientTransport(new URL(serviceUrl));
    const client = new Client(
      { name: "ghost-peppers-mem", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    return {
      client,
      async close() {
        try {
          await client.close();
        } finally {
          await transport.close();
        }
      },
    };
  }

  // ── Local-dev path: spawn the package as a uvx stdio subprocess ───────────
  if (connection === undefined) {
    throw new Error(
      "connectMemory: provide serviceUrl/PEPPERS_MEMORY_MCP_URL (SSE service) " +
        "or `connection` (Neo4j creds for the local uvx subprocess).",
    );
  }

  const args = [
    ...(opts.uvxArgs ?? DEFAULT_UVX_ARGS),
    "--uri",
    connection.uri,
    "--user",
    connection.username,
    "--profile",
    profile,
  ];
  if (connection.database) {
    args.push("--database", connection.database);
  }

  // Password goes via env (NEO4J_PASSWORD), not argv — keeps it out of
  // any process listing.
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    NEO4J_PASSWORD: connection.password,
  };

  const transport = new StdioClientTransport({
    command: "uvx",
    args,
    env,
  });

  const client = new Client(
    { name: "ghost-peppers-mem", version: "0.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    client,
    async close() {
      try {
        await client.close();
      } finally {
        // Close the transport after the client so the uvx subprocess is
        // reliably terminated and stdio handles are released.
        await transport.close();
      }
    },
  };
}
