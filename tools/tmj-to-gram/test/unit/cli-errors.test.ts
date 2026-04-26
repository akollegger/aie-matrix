import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const cliJs = join(repoRoot, "tools/tmj-to-gram/dist/main.js");

function runConvert(args: string[], cwd: string = repoRoot): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, [cliJs, "convert", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

let cleanupDir: string | undefined;

afterEach(async () => {
  if (cleanupDir !== undefined) {
    await rm(cleanupDir, { recursive: true, force: true });
    cleanupDir = undefined;
  }
});

describe("convert CLI errors", () => {
  it("missing h3_anchor exits 1 with [error]", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmj-gram-"));
    cleanupDir = dir;
    const bad = join(dir, "bad.tmj");
    await writeFile(
      bad,
      JSON.stringify({
        width: 1,
        height: 1,
        tilewidth: 32,
        tileheight: 28,
        hexsidelength: 16,
        staggeraxis: "x",
        staggerindex: "odd",
        properties: [{ name: "h3_resolution", type: "int", value: 15 }],
        layers: [
          {
            type: "tilelayer",
            class: "layout",
            width: 1,
            height: 1,
            data: [0],
          },
        ],
        tilesets: [],
      }),
      "utf8",
    );
    const { status, stderr } = runConvert([bad]);
    expect(status).toBe(1);
    expect(stderr).toContain("[error]");
    expect(stderr).toMatch(/h3_anchor/i);
  });

  it("h3_resolution not 15 exits 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmj-gram-"));
    cleanupDir = dir;
    const bad = join(dir, "bad2.tmj");
    await writeFile(
      bad,
      JSON.stringify({
        width: 1,
        height: 1,
        tilewidth: 32,
        tileheight: 28,
        hexsidelength: 16,
        staggeraxis: "x",
        staggerindex: "odd",
        properties: [
          { name: "h3_anchor", type: "string", value: "8f2830828052d25" },
          { name: "h3_resolution", type: "int", value: 10 },
        ],
        layers: [
          {
            type: "tilelayer",
            class: "layout",
            width: 1,
            height: 1,
            data: [0],
          },
        ],
        tilesets: [],
      }),
      "utf8",
    );
    const { status, stderr } = runConvert([bad]);
    expect(status).toBe(1);
    expect(stderr).toContain("[error]");
    expect(stderr).toMatch(/h3_resolution/);
  });

  it("--out under non-existent directory exits 3", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmj-gram-"));
    cleanupDir = dir;
    const tmj = join(dir, "x.tmj");
    await writeFile(
      tmj,
      JSON.stringify({
        width: 1,
        height: 1,
        tilewidth: 32,
        tileheight: 28,
        hexsidelength: 16,
        staggeraxis: "x",
        staggerindex: "odd",
        properties: [
          { name: "h3_anchor", type: "string", value: "8f2830828052d25" },
          { name: "h3_resolution", type: "int", value: 15 },
        ],
        layers: [
          {
            type: "tilelayer",
            class: "layout",
            width: 1,
            height: 1,
            data: [0],
          },
        ],
        tilesets: [],
      }),
      "utf8",
    );
    const out = join(dir, "nope", "missing", "out.map.gram");
    const { status, stderr } = runConvert([tmj, "--out", out]);
    expect(status).toBe(3);
    expect(stderr).toContain("[error]");
  });

  it("--out to non-writable directory exits 3", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tmj-gram-"));
    cleanupDir = dir;
    const ro = join(dir, "readonly-parent");
    await mkdir(ro);
    await chmod(ro, 0o555);
    const tmj = join(dir, "x.tmj");
    await writeFile(
      tmj,
      JSON.stringify({
        width: 1,
        height: 1,
        tilewidth: 32,
        tileheight: 28,
        hexsidelength: 16,
        staggeraxis: "x",
        staggerindex: "odd",
        properties: [
          { name: "h3_anchor", type: "string", value: "8f2830828052d25" },
          { name: "h3_resolution", type: "int", value: 15 },
        ],
        layers: [
          {
            type: "tilelayer",
            class: "layout",
            width: 1,
            height: 1,
            data: [0],
          },
        ],
        tilesets: [],
      }),
      "utf8",
    );
    const out = join(ro, "out.map.gram");
    const { status, stderr } = runConvert([tmj, "--out", out]);
    expect(status).toBe(3);
    expect(stderr).toContain("[error]");
    await chmod(ro, 0o755);
  });
});
