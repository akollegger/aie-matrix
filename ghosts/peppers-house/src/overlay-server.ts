/**
 * Optional HTTP + SSE server that powers the peppers ghost overlay.
 * Serves the static overlay HTML at `/` and a live event stream at
 * `/events`. Disabled by default; opt in by setting
 * `PEPPERS_OVERLAY_PORT` (or passing `overlayPort` to `runHouse`).
 *
 * The overlay is intentionally separate from `client/phaser` — it's a
 * standalone debug surface, not part of the main spectator. Browsers
 * connect, receive an `init` event with current state, then stream
 * `cascade` events as the ghost lives.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export interface OverlayServer {
  readonly port: number;
  broadcast(eventName: string, data: unknown): void;
  close(): Promise<void>;
}

export interface OverlayServerOptions {
  readonly port: number;
  /** Called when a new client connects, to send its initial state. */
  readonly getInit: () => unknown;
  /**
   * If set, this overlay also serves a `/all` route — a single page
   * that grids every listed port in iframes. Use it from ghost #0 in
   * multi-ghost mode so the user can watch every ghost in one tab.
   */
  readonly peerPorts?: ReadonlyArray<number>;
}

export async function startOverlayServer(opts: OverlayServerOptions): Promise<OverlayServer> {
  const clients = new Set<ServerResponse>();
  // overlay/ lives at the package root, so it resolves the same whether
  // we're running from src/ (via tsx) or dist/ (via node).
  const overlayDir = join(moduleDir, "..", "overlay");
  const indexHtml = await readFile(join(overlayDir, "index.html"), "utf8");

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      try {
        const init = opts.getInit();
        res.write(`event: init\ndata: ${JSON.stringify(init)}\n\n`);
      } catch (err) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`,
        );
      }
      clients.add(res);
      const cleanup = (): void => {
        clients.delete(res);
      };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
      return;
    }

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
      return;
    }

    if (url === "/all" && opts.peerPorts && opts.peerPorts.length > 0) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHubPage(opts.peerPorts));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.info(`[peppers-house] overlay listening at http://127.0.0.1:${opts.port}/`);
  if (opts.peerPorts && opts.peerPorts.length > 1) {
    console.info(
      `[peppers-house] hub view (all ghosts in one tab): http://127.0.0.1:${opts.port}/all`,
    );
  }

  return {
    port: opts.port,
    broadcast(eventName: string, data: unknown): void {
      const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of [...clients]) {
        try {
          client.write(payload);
        } catch {
          clients.delete(client);
        }
      }
    },
    async close(): Promise<void> {
      for (const c of [...clients]) {
        try {
          c.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/** Renders a tiny grid page that iframes each peer overlay. */
function renderHubPage(ports: ReadonlyArray<number>): string {
  const cols = ports.length <= 2 ? ports.length : 2;
  const frames = ports
    .map(
      (p) => `
    <div class="cell">
      <div class="cell-label">port ${p}</div>
      <iframe src="http://127.0.0.1:${p}/" loading="lazy"></iframe>
    </div>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Peppers Ghosts — Hub</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0d1117; color: #e6edf3;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .grid { display: grid;
      grid-template-columns: repeat(${cols}, 1fr);
      grid-auto-rows: 1fr;
      gap: 6px; padding: 6px;
      height: 100vh; box-sizing: border-box; }
    .cell { position: relative; border: 1px solid #30363d; border-radius: 6px;
      overflow: hidden; background: #161b22; min-height: 0; }
    .cell-label { position: absolute; top: 6px; right: 8px; z-index: 2;
      font-size: 10px; color: #8b949e; font-family: ui-monospace, monospace;
      background: rgba(13, 17, 23, 0.7); padding: 2px 6px; border-radius: 4px; }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: #0d1117; }
  </style>
</head>
<body>
  <div class="grid">${frames}
  </div>
</body>
</html>`;
}
