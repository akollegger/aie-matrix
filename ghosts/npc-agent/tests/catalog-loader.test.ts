import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCatalog } from "../src/catalog/catalog-loader.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_ENABLED = `
{ kind: "matrix-character" }
(charGuide:Character { id: "guide", name: "Conference Guide",
  background: "Welcomes attendees.", enabled: true, defaultAction: "idle" })
(idle:DialogNode { responses: ["Let me find out!"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charGuide)-[:HAS_DIALOG]->(dialog_1)
`;

const VALID_DISABLED = `
{ kind: "matrix-character" }
(charHermit:Character { id: "hermit", name: "The Hermit",
  background: "Prefers solitude.", enabled: false, defaultAction: "stay" })
(idle:DialogNode { responses: ["..."] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charHermit)-[:HAS_DIALOG]->(dialog_1)
`;

const VALID_SECOND = `
{ kind: "matrix-character" }
(charCollector:Character { id: "collector", name: "Collector",
  background: "Seeks rare items.", enabled: true, defaultAction: "random-move" })
(idle:DialogNode { responses: ["I collect things."] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charCollector)-[:HAS_DIALOG]->(dialog_1)
`;

const MALFORMED = `this is not valid gram at all {{{`;

// Duplicate of VALID_ENABLED (same id: "guide")
const DUPLICATE_ID = `
{ kind: "matrix-character" }
(charDup:Character { id: "guide", name: "Guide Duplicate",
  background: "Another guide.", enabled: true, defaultAction: "idle" })
(idle:DialogNode { responses: ["Hello?"] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle) ]
(charDup)-[:HAS_DIALOG]->(dialog_1)
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "npc-catalog-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeGram(filename: string, content: string): Promise<void> {
  await writeFile(join(tmpDir, filename), content, "utf8");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadCatalog", () => {
  it("returns empty catalog when directory does not exist", async () => {
    const catalog = await loadCatalog(join(tmpDir, "nonexistent"));
    expect(catalog.enabled()).toHaveLength(0);
    expect(catalog.byId.size).toBe(0);
  });

  it("returns empty catalog for an empty directory", async () => {
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.enabled()).toHaveLength(0);
    expect(catalog.byId.size).toBe(0);
  });

  it("ignores files that do not end in .character.gram", async () => {
    await writeFile(join(tmpDir, "readme.txt"), "not a character");
    await writeFile(join(tmpDir, "map.gram"), "also not a character");
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.byId.size).toBe(0);
  });

  it("loads a single valid enabled character", async () => {
    await writeGram("guide.character.gram", VALID_ENABLED);
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.byId.size).toBe(1);
    expect(catalog.byId.get("guide")?.name).toBe("Conference Guide");
    expect(catalog.enabled()).toHaveLength(1);
  });

  it("loads a disabled character into byId but excludes from enabled()", async () => {
    await writeGram("hermit.character.gram", VALID_DISABLED);
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.byId.size).toBe(1);
    expect(catalog.byId.get("hermit")?.enabled).toBe(false);
    expect(catalog.enabled()).toHaveLength(0);
  });

  it("loads multiple valid files", async () => {
    await writeGram("guide.character.gram", VALID_ENABLED);
    await writeGram("collector.character.gram", VALID_SECOND);
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.byId.size).toBe(2);
    expect(catalog.enabled()).toHaveLength(2);
  });

  it("skips malformed files with a warning and continues loading others", async () => {
    await writeGram("bad.character.gram", MALFORMED);
    await writeGram("guide.character.gram", VALID_ENABLED);
    const catalog = await loadCatalog(tmpDir);
    // Only the valid file loads
    expect(catalog.byId.size).toBe(1);
    expect(catalog.byId.get("guide")).toBeDefined();
  });

  it("skips the second file when two files share the same id", async () => {
    // Write first file with id "guide"
    await writeGram("a-guide.character.gram", VALID_ENABLED);
    // Write second file also with id "guide"
    await writeGram("z-guide-dup.character.gram", DUPLICATE_ID);
    const catalog = await loadCatalog(tmpDir);
    // Only one entry, and it should be the first one loaded (alphabetical: a before z)
    expect(catalog.byId.size).toBe(1);
    expect(catalog.byId.get("guide")?.name).toBe("Conference Guide");
  });

  it("enabled() returns only enabled characters across a mixed catalog", async () => {
    await writeGram("guide.character.gram", VALID_ENABLED);
    await writeGram("hermit.character.gram", VALID_DISABLED);
    await writeGram("collector.character.gram", VALID_SECOND);
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.byId.size).toBe(3);
    const enabledIds = catalog.enabled().map((c) => c.id).sort();
    expect(enabledIds).toEqual(["collector", "guide"]);
  });

  it("NPC_CATALOG_DIR env is read by agent.ts (not catalog-loader) — default is ./catalog", async () => {
    // catalog-loader itself takes an explicit path; the env-var wiring is in agent.ts.
    // This test documents that expectation explicitly.
    await writeGram("guide.character.gram", VALID_ENABLED);
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.byId.size).toBe(1);
  });

  it("handles a directory with only non-gram files gracefully", async () => {
    await writeFile(join(tmpDir, "notes.md"), "# Notes");
    const catalog = await loadCatalog(tmpDir);
    expect(catalog.enabled()).toHaveLength(0);
  });

  it("loads files from a nested path (NPC_CATALOG_DIR with subdirectory)", async () => {
    const subDir = join(tmpDir, "characters");
    await mkdir(subDir);
    await writeFile(join(subDir, "guide.character.gram"), VALID_ENABLED);
    const catalog = await loadCatalog(subDir);
    expect(catalog.byId.get("guide")).toBeDefined();
  });
});
