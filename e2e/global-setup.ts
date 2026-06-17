import { execSync } from "node:child_process";
import * as path from "node:path";

export default async function globalSetup(): Promise<void> {
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
