#!/usr/bin/env node
/**
 * Removes TypeScript / Vite build outputs (`dist`) and incremental caches (`*.tsbuildinfo`)
 * under the repo root. Skips `node_modules` and `.git`.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git"]);

/** @param {string} dir */
async function cleanTree(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;
    const full = path.join(dir, name);
    if (ent.isDirectory()) {
      if (SKIP.has(name)) continue;
      if (name === "dist") {
        console.log(`remove ${path.relative(repoRoot, full)}`);
        await rm(full, { recursive: true, force: true });
      } else {
        await cleanTree(full);
      }
    } else if (ent.isFile() && name.endsWith(".tsbuildinfo")) {
      console.log(`remove ${path.relative(repoRoot, full)}`);
      await rm(full, { force: true });
    }
  }
}

await cleanTree(repoRoot);
