import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const autostart = process.env.E2E_AUTOSTART === "1";
/** Autostart stack serves Phaser via `vite preview` on 5179; manual runs default to Vite dev on 5174. */
const baseURL =
  process.env.E2E_BASE_URL ??
  (autostart ? "http://127.0.0.1:5179" : "http://127.0.0.1:5174");
const reuse = !process.env.CI;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.mjs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 25_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  ...(autostart
    ? {
        webServer: {
          command: `node ${path.join(repoRoot, "e2e", "dev-stack.mjs")}`,
          cwd: repoRoot,
          url: "http://127.0.0.1:5179/",
          reuseExistingServer: reuse,
          timeout: 240_000,
        },
      }
    : {}),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
