import { getResolution, isValidCell } from "h3-js";
import { test, expect } from "./fixtures.js";

function assertH3Res15(cell: string): void {
  expect(isValidCell(cell)).toBe(true);
  expect(getResolution(cell)).toBe(15);
}

test("adoption returns valid credentials", async ({ ghost }) => {
  expect(ghost.ghostId.length).toBeGreaterThan(0);
  expect(ghost.token.length).toBeGreaterThan(0);
  expect(ghost.worldApiBaseUrl).toContain("http");
});

test("whereami returns valid H3 res-15 index", async ({ ghost }) => {
  const loc = (await ghost.mcp.callTool("whereami", {})) as { h3Index: string; tileId: string };
  expect(loc.h3Index).toBeTruthy();
  assertH3Res15(loc.h3Index);
  expect(loc.tileId).toBe(loc.h3Index);
});

test("exits returns at least one compass direction", async ({ ghost }) => {
  const ex = (await ghost.mcp.callTool("exits", {})) as {
    exits: Array<{ toward: string; tileId: string }>;
  };
  expect(Array.isArray(ex.exits)).toBe(true);
  expect(ex.exits.length).toBeGreaterThan(0);
  assertH3Res15(ex.exits[0].tileId);
});

test("go moves to a valid new H3 cell", async ({ ghost }) => {
  const ex = (await ghost.mcp.callTool("exits", {})) as {
    exits: Array<{ toward: string }>;
  };
  const before = ((await ghost.mcp.callTool("whereami", {})) as { h3Index: string }).h3Index;

  const result = (await ghost.mcp.callTool("go", { toward: ex.exits[0].toward })) as {
    ok: boolean;
    tileId?: string;
  };
  expect(result.ok).toBe(true);
  assertH3Res15(result.tileId!);
  expect(result.tileId).not.toBe(before);
});

test("10-step walk completes without error", async ({ ghost }) => {
  for (let i = 0; i < 10; i++) {
    const ex = (await ghost.mcp.callTool("exits", {})) as {
      exits: Array<{ toward: string }>;
    };
    expect(ex.exits.length).toBeGreaterThan(0);
    const result = (await ghost.mcp.callTool("go", { toward: ex.exits[0].toward })) as {
      ok: boolean;
      tileId: string;
    };
    expect(result.ok).toBe(true);
    assertH3Res15(result.tileId);
  }
});

test("two ghosts maintain independent positions", async ({ ghost, ghost2 }) => {
  const ex = (await ghost2.mcp.callTool("exits", {})) as {
    exits: Array<{ toward: string }>;
  };
  await ghost2.mcp.callTool("go", { toward: ex.exits[0].toward });

  const loc1 = ((await ghost.mcp.callTool("whereami", {})) as { h3Index: string }).h3Index;
  const loc2 = ((await ghost2.mcp.callTool("whereami", {})) as { h3Index: string }).h3Index;
  expect(loc1).not.toBe(loc2);
});
