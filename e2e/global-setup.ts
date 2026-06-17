import { execSync } from "node:child_process";
import * as path from "node:path";

export default async function globalSetup(): Promise<void> {
  // When STAGING_STACK=true the full stack (Neo4j, Redis, server) is already running.
  // Spinning up docker-compose.dev.yml would recreate the shared Redis/Neo4j containers
  // and break the server's connections mid-run.
  if (process.env["STAGING_STACK"] === "true") {
    console.log("[e2e] STAGING_STACK=true — skipping dev service startup (using live stack).");
    return;
  }

  // process.cwd() is the e2e/ package directory when invoked via pnpm filter
  const repoRoot = path.resolve(process.cwd(), "..");
  const composeFile = path.join(repoRoot, "docker-compose.dev.yml");

  console.log("[e2e] Starting stateful services (Neo4j + Redis) and waiting for healthchecks…");
  execSync(`docker compose -f "${composeFile}" up -d --wait`, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  console.log("[e2e] All services healthy.");
}
