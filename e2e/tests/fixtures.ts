import { test as base, expect } from "@playwright/test";
import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { adopt, type GhostCredential } from "./helpers/adopt.js";
import { makeClient } from "./helpers/mcp.js";

export type Ghost = GhostCredential & { mcp: GhostMcpClient };

export const test = base.extend<{
  ghost: Ghost;
  ghost2: Ghost;
}>({
  ghost: async ({}, use) => {
    const cred = await adopt();
    const mcp = makeClient(cred);
    await mcp.connect();
    await use({ ...cred, mcp });
    await mcp.disconnect().catch(() => {});
  },
  ghost2: async ({}, use) => {
    const cred = await adopt();
    const mcp = makeClient(cred);
    await mcp.connect();
    await use({ ...cred, mcp });
    await mcp.disconnect().catch(() => {});
  },
});

export { expect };
