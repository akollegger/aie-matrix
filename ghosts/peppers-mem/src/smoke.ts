/**
 * Milestone 4 smoke script: spawn the Agent Memory MCP server against
 * PeppersGhosts, list its tools, write one event, read one event back.
 *
 * Run with:
 *   pnpm --filter @aie-matrix/ghost-peppers-mem run smoke
 *
 * Requires GHOST_MINDS_NEO4J_{URI,USERNAME,PASSWORD,DATABASE} in .env at
 * the repo root. Writes a tiny amount of data to PeppersGhosts; safe to
 * leave or wipe.
 */

import { randomUUID } from "node:crypto";

import { loadRootEnv } from "@aie-matrix/root-env";

import { connectMemory } from "./client.js";

loadRootEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}; check .env at repo root`);
  }
  return value;
}

function inspect(label: string, value: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const handle = await connectMemory({
    connection: {
      uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
      username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
      password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
      database: process.env.GHOST_MINDS_NEO4J_DATABASE,
    },
    profile: "core",
  });

  try {
    const tools = await handle.client.listTools();
    inspect(
      "Tools available (core profile)",
      tools.tools.map((t) => ({ name: t.name, description: t.description?.split("\n")[0] })),
    );

    // Identify a write-style tool for messages and a read/search tool by
    // common naming heuristics. We do not hard-code names; tool names
    // depend on the upstream Agent Memory package version and may evolve.
    const writeTool = tools.tools.find((t) =>
      /(store|add|write|put|append).*(message|memory|conversation)/i.test(t.name),
    );
    const readTool = tools.tools.find((t) => /(search|query|get).*?(memor|messag|context)/i.test(t.name));

    if (!writeTool) {
      inspect("FAIL", "Could not find a write-style tool by heuristic");
      return;
    }
    if (!readTool) {
      inspect("FAIL", "Could not find a read-style tool by heuristic");
      return;
    }

    inspect("Selected tools", { write: writeTool.name, read: readTool.name });

    const sessionId = `peppers-smoke-${randomUUID()}`;
    const marker = `peppers-smoke-marker-${randomUUID()}`;

    inspect("Write tool input schema", writeTool.inputSchema);
    inspect("Read tool input schema", readTool.inputSchema);

    // The write call's exact parameter names depend on the tool's
    // schema. We log the schema and attempt a best-effort invocation
    // with common names; mismatches will produce a clear error from the
    // server, which is itself a useful smoke result.
    const writeArgs = inferWriteArgs(writeTool.inputSchema, sessionId, marker);
    inspect("Write call args", writeArgs);
    const writeResult = await handle.client.callTool({
      name: writeTool.name,
      arguments: writeArgs,
    });
    inspect("Write result", writeResult);

    const readArgs = inferReadArgs(readTool.inputSchema, sessionId, marker);
    inspect("Read call args", readArgs);
    const readResult = await handle.client.callTool({
      name: readTool.name,
      arguments: readArgs,
    });
    inspect("Read result", readResult);

    inspect("OK", `wrote and read marker=${marker} session=${sessionId}`);
  } finally {
    await handle.close();
  }
}

/**
 * Build write-tool args by inspecting the tool's JSON Schema and
 * matching common Agent Memory parameter names. Falls back to a
 * minimal payload if the schema is permissive.
 */
function inferWriteArgs(
  schema: unknown,
  sessionId: string,
  content: string,
): Record<string, unknown> {
  const props = schemaProperties(schema);
  const args: Record<string, unknown> = {};
  // Common parameter names across Agent Memory versions
  if ("session_id" in props) args.session_id = sessionId;
  else if ("sessionId" in props) args.sessionId = sessionId;
  if ("role" in props) args.role = "user";
  if ("content" in props) args.content = content;
  else if ("text" in props) args.text = content;
  else if ("message" in props) args.message = content;
  return args;
}

function inferReadArgs(
  schema: unknown,
  sessionId: string,
  query: string,
): Record<string, unknown> {
  const props = schemaProperties(schema);
  const args: Record<string, unknown> = {};
  if ("session_id" in props) args.session_id = sessionId;
  else if ("sessionId" in props) args.sessionId = sessionId;
  if ("query" in props) args.query = query;
  else if ("q" in props) args.q = query;
  else if ("text" in props) args.text = query;
  return args;
}

function schemaProperties(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const obj = schema as { properties?: unknown };
  if (!obj.properties || typeof obj.properties !== "object") return {};
  return obj.properties as Record<string, unknown>;
}

main().catch((err: unknown) => {
  console.error("Smoke FAILED:", err);
  process.exit(1);
});
