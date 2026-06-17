import { execSync } from "node:child_process";
import * as path from "node:path";

export default async function globalSetup(): Promise<void> {
  // In STAGING_STACK mode the full deploy/staging compose stack already provides
  // Neo4j + Redis (internal to its network). Bringing up the Tier-1 dev compose
  // here would be redundant and collides on host ports 7474/7687/6379. The
  // webServer block in playwright.config.ts is already gated the same way.
  if (process.env["STAGING_STACK"] === "true") {
    console.log("[e2e] STAGING_STACK=true — using the running staging compose stack; skipping dev Neo4j/Redis bring-up.");
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
