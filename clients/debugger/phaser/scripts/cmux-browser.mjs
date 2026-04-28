#!/usr/bin/env node
/**
 * Opens a cmux browser pane pointed at the Vite dev server (Phaser spectator).
 *
 * Env:
 *   VITE_DEV_BROWSER_URL   Dev app URL (default http://127.0.0.1:5174 — matches vite.config server.port)
 *   CMUX_CLIENT_WORKSPACE  Optional cmux workspace ref (e.g. workspace:3) when not launched from that workspace
 *
 * Requires `cmux` on PATH (https://cmux.app).
 */
import { spawnSync } from "node:child_process";

const url = process.env.VITE_DEV_BROWSER_URL ?? "http://127.0.0.1:5174";
const workspace = process.env.CMUX_CLIENT_WORKSPACE?.trim();

const args = [
  "new-pane",
  ...(workspace ? ["--workspace", workspace] : []),
  "--type",
  "browser",
  "--direction",
  "down",
  "--url",
  url,
];

const r = spawnSync("cmux", args, { stdio: "inherit" });
if (r.error && /** @type {NodeJS.ErrnoException} */ (r.error).code === "ENOENT") {
  console.error("cmux not found on PATH. Install cmux or run from a shell where `cmux` is available.");
  process.exit(127);
}
process.exit(r.status ?? 1);
