import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function waitUrl(url, label, maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        console.info(`[e2e dev-stack] ${label} ready: ${url}`);
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[e2e dev-stack] timeout waiting for ${label}: ${url}`);
}

async function tryOk(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

/** @type {import("node:child_process").ChildProcess | null} */
let server = null;
if (await tryOk("http://127.0.0.1:8787/spectator/room")) {
  console.info("[e2e dev-stack] reusing existing combined server on :8787");
} else {
  server = spawn("pnpm", ["--filter", "@aie-matrix/server", "start"], {
    cwd: root,
    stdio: "inherit",
  });
  await waitUrl("http://127.0.0.1:8787/spectator/room", "combined server (node dist)");
}

/** @type {import("node:child_process").ChildProcess | null} */
let vite = null;
if (await tryOk("http://127.0.0.1:5179/")) {
  console.info("[e2e dev-stack] reusing existing listener on :5179");
} else {
  vite = spawn(
    "pnpm",
    ["--filter", "@aie-matrix/client-phaser", "exec", "vite", "preview", "--host", "127.0.0.1", "--port", "5179", "--strictPort"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  await waitUrl("http://127.0.0.1:5179/", "Vite preview (client/phaser dist)");
}

function shutdown() {
  server?.kill("SIGTERM");
  vite?.kill("SIGTERM");
}

await new Promise((resolve) => {
  const onStop = () => {
    shutdown();
    resolve();
  };
  process.once("SIGTERM", onStop);
  process.once("SIGINT", onStop);
});
