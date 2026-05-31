#!/usr/bin/env node
/**
 * Cut a release: bump version, commit, tag, push.
 * Triggers the production-deploy CI workflow automatically via the v*.*.* tag.
 *
 * Usage:
 *   node scripts/release.mjs          # interactive prompt
 *   node scripts/release.mjs patch
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs major
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(repoRoot, "package.json");

function run(cmd, { silent = false } = {}) {
  const out = execSync(cmd, { cwd: repoRoot, encoding: "utf8", stdio: silent ? "pipe" : "inherit" });
  return out ? out.trim() : "";
}

function ask(question, options) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const hint = options ? ` [${options.join("/")}]` : "";
    rl.question(`${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Preflight ──────────────────────────────────────────────────────────────

const branch = run("git rev-parse --abbrev-ref HEAD", { silent: true });
if (branch !== "main") {
  console.error(`✗ Must be on main (currently on ${branch})`);
  process.exit(1);
}

const dirty = run("git status --porcelain", { silent: true });
if (dirty) {
  console.error("✗ Working tree is not clean. Commit or stash changes first.");
  process.exit(1);
}

run("git fetch --tags --quiet", { silent: true });
const behind = run("git rev-list HEAD..origin/main --count", { silent: true });
if (behind !== "0") {
  console.error(`✗ Branch is ${behind} commit(s) behind origin/main. Pull first.`);
  process.exit(1);
}

// ── Resolve bump type ──────────────────────────────────────────────────────

const BUMP_TYPES = ["patch", "minor", "major"];
let bumpType = process.argv[2];

if (!bumpType) {
  bumpType = await ask("Bump type", BUMP_TYPES);
}

if (!BUMP_TYPES.includes(bumpType)) {
  console.error(`✗ Unknown bump type "${bumpType}". Choose: ${BUMP_TYPES.join(", ")}`);
  process.exit(1);
}

// ── Bump version ───────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = (pkg.version ?? "0.0.0").split(".").map(Number);

const next = {
  major: `${major + 1}.0.0`,
  minor: `${major}.${minor + 1}.0`,
  patch: `${major}.${minor}.${patch + 1}`,
}[bumpType];

const tag = `v${next}`;

console.log(`\n  ${pkg.version ?? "0.0.0"} → ${next}  (${tag})\n`);
const confirm = await ask("Proceed?", ["y", "N"]);
if (confirm.toLowerCase() !== "y") {
  console.log("Aborted.");
  process.exit(0);
}

// ── Write, commit, tag, push ───────────────────────────────────────────────

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

run(`git add package.json`);
run(`git commit -s -m "chore: release ${tag}"`);
run(`git tag -a ${tag} -m "Release ${tag}"`);
run(`git push origin main --follow-tags`);

console.log(`\n✓ Tagged and pushed ${tag} — CI deploy workflow starting.\n`);
console.log(`  https://github.com/akollegger/aie-matrix/actions\n`);
