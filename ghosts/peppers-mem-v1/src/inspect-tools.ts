/**
 * Diagnostic: list every tool the Agent Memory MCP exposes under both
 * profiles, with their input schemas summarized. Used for figuring out
 * which tool to call for which event type — especially the
 * reasoning-trace tools that the core profile omits.
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { connectMemory } from "./client.js";

loadRootEnv();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function listProfile(profile: "core" | "extended"): Promise<void> {
  const handle = await connectMemory({
    connection: {
      uri: requireEnv("GHOST_MINDS_NEO4J_URI"),
      username: requireEnv("GHOST_MINDS_NEO4J_USERNAME"),
      password: requireEnv("GHOST_MINDS_NEO4J_PASSWORD"),
      database: process.env.GHOST_MINDS_NEO4J_DATABASE,
    },
    profile,
  });
  try {
    const tools = await handle.client.listTools();
    console.log(`\n========== ${profile.toUpperCase()} PROFILE: ${tools.tools.length} tools ==========`);
    for (const t of tools.tools) {
      const desc = (t.description ?? "").split("\n")[0];
      const props = (t.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
      const paramNames = props ? Object.keys(props).join(", ") : "";
      console.log(`\n  ${t.name}`);
      console.log(`    ${desc}`);
      if (paramNames) console.log(`    params: ${paramNames}`);
    }
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  await listProfile("core");
  await listProfile("extended");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
