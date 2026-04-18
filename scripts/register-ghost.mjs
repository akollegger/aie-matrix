#!/usr/bin/env node
/**
 * One-shot ghost registration: creates a ghost house + caretaker, adopts a ghost,
 * and writes GHOST_TOKEN to `.env` at the repo root. `WORLD_API_URL` is written only when
 * it is not already set in the environment or in the existing `.env` file.
 *
 * Usage: pnpm run ghost:register
 * Requires: combined server running (pnpm run server)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
  return env;
}

function upsertEnvLine(content, key, value) {
  const prefix = `${key}=`;
  const newLine = `${key}=${value}`;
  const lines = content.split("\n");
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(prefix)) { found = true; return newLine; }
    return line;
  });
  if (!found) updated.push(newLine);
  return updated.join("\n");
}

async function postJson(base, pathname, body) {
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const code = e?.cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      throw new Error(
        `Cannot reach registry at ${base} (${code}).\nStart the server first: pnpm run server`,
      );
    }
    throw e;
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Registry ${pathname} failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function main() {
  const fileEnv = loadEnvFile(envPath);
  const registryBase =
    process.env.AIE_MATRIX_REGISTRY_BASE ??
    fileEnv.AIE_MATRIX_REGISTRY_BASE ??
    "http://127.0.0.1:8787";

  console.log(`ghost:register — connecting to ${registryBase}…`);

  const { ghostHouseId } = await postJson(registryBase, "/registry/houses", {
    displayName: "ghost-cli-user",
  });

  const { caretakerId } = await postJson(registryBase, "/registry/caretakers", {
    label: "ghost-cli",
  });

  const { ghostId, credential } = await postJson(registryBase, "/registry/adopt", {
    caretakerId,
    ghostHouseId,
  });

  const worldApiUrl = credential.worldApiBaseUrl.endsWith("/mcp")
    ? credential.worldApiBaseUrl
    : `${credential.worldApiBaseUrl}/mcp`;

  const hadWorldUrl =
    Boolean(String(process.env.WORLD_API_URL ?? "").trim()) ||
    Boolean(String(fileEnv.WORLD_API_URL ?? "").trim());

  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  content = upsertEnvLine(content, "GHOST_TOKEN", credential.token);
  if (!hadWorldUrl) {
    content = upsertEnvLine(content, "WORLD_API_URL", worldApiUrl);
  }
  writeFileSync(envPath, content, "utf8");

  console.log(`✓ Ghost adopted: ${ghostId}`);
  console.log(`✓ GHOST_TOKEN written to .env`);
  if (!hadWorldUrl) {
    console.log(`✓ WORLD_API_URL=${worldApiUrl} written to .env`);
  } else {
    console.log(`✓ WORLD_API_URL left unchanged (already set in env or .env)`);
  }
  console.log(`\nNext: pnpm run ghost:cli           # interactive REPL`);
  console.log(`      pnpm run ghost:cli -- whoami   # one-shot`);
}

main().catch((err) => {
  console.error("ghost:register failed:", err.message ?? String(err));
  process.exit(1);
});
