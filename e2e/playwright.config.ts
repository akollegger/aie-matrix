import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  retries: process.env["CI"] ? 2 : 0,
  reporter: [
    ["html", { outputFolder: "test-results", open: "never" }],
    ["list"],
  ],
  use: {
    baseURL: "http://127.0.0.1:8787",
  },
  webServer: {
    command: "pnpm --filter @aie-matrix/server dev",
    url: "http://127.0.0.1:8787/health",
    reuseExistingServer: !process.env["CI"],
    timeout: 90_000,
    env: {
      AIE_MATRIX_MAP: "maps/sandbox/read-and-collect.map.gram",
      AIE_MATRIX_TCK_MODE: "1",
      NEO4J_URI: process.env["NEO4J_URI"] ?? "bolt://localhost:7687",
      NEO4J_USER: process.env["NEO4J_USER"] ?? "neo4j",
      NEO4J_PASSWORD: process.env["NEO4J_PASSWORD"] ?? "devpassword",
      AGENT_HOST_TOKEN: process.env["AGENT_HOST_TOKEN"] ?? "dev-secret-change-me",
    },
  },
});
