/**
 * Saloon overlay HTTP + SSE server.
 *
 * Restored from RFC-0019 phase 5b.2c (the previous incarnation lived in
 * `ghosts/rdc-orchestrator/overlay/` and was deleted alongside the
 * orchestrator package). The static HTML lives in `overlay/index.html`;
 * this module mounts it on the session process's existing Express app
 * and exposes a broadcaster the session-loop pipes hand events into.
 *
 * Mount once at process start with `mountOverlay(app, broadcaster)`.
 * The session emits via `broadcaster.emit(eventName, data)`; the snapshot
 * (sent immediately to any new SSE client) is refreshed with
 * `broadcaster.setSnapshot(...)` so late-joiners see current state.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type express from "express";
import type { Request, Response } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Resolves to <pkg>/overlay/index.html — works for both dev (src/) and dist/. */
const DEFAULT_OVERLAY_HTML = path.resolve(__dirname, "..", "overlay", "index.html");

interface SseClient {
  readonly id: number;
  readonly res: Response;
}

/**
 * Broadcasts SSE events to connected overlay clients. Holds the latest
 * snapshot so a fresh tab pulls full state before live events stream in.
 */
export class OverlayBroadcaster {
  private clients = new Map<number, SseClient>();
  private nextId = 1;
  private snapshot: Record<string, unknown> = {};

  /** Replace the snapshot served to newly-connecting SSE clients. */
  setSnapshot(s: Record<string, unknown>): void {
    this.snapshot = s;
  }

  /** Merge fields into the existing snapshot (for incremental updates). */
  patchSnapshot(p: Record<string, unknown>): void {
    this.snapshot = { ...this.snapshot, ...p };
  }

  /** Push a named event to every connected SSE client. */
  emit(eventName: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const line = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients.values()) {
      try {
        c.res.write(line);
      } catch {
        /* client dropped; cleanup happens on req.close */
      }
    }
  }

  addClient(res: Response): number {
    const id = this.nextId++;
    this.clients.set(id, { id, res });
    // Bootstrap with the current snapshot so late-joiners aren't blank.
    try {
      res.write(`event: snapshot\ndata: ${JSON.stringify(this.snapshot)}\n\n`);
    } catch {
      this.clients.delete(id);
    }
    return id;
  }

  removeClient(id: number): void {
    this.clients.delete(id);
  }

  size(): number {
    return this.clients.size;
  }
}

/**
 * Mount the saloon overlay onto an existing Express app.
 *
 *   GET /            → serves overlay/index.html
 *   GET /events      → SSE stream
 *
 * Both routes are unauthenticated — the overlay is a local debug
 * surface, not a production-facing UI. Lock it behind a reverse proxy
 * if you ever expose this port externally.
 */
export function mountOverlay(
  app: express.Express,
  broadcaster: OverlayBroadcaster,
  opts: { readonly htmlPath?: string } = {},
): void {
  const htmlPath = opts.htmlPath ?? DEFAULT_OVERLAY_HTML;

  app.get("/", async (_req: Request, res: Response) => {
    try {
      const html = await readFile(htmlPath, "utf8");
      res.type("html").send(html);
    } catch (e) {
      res
        .status(500)
        .type("text/plain")
        .send(
          `overlay HTML not found at ${htmlPath}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
    }
  });

  app.get("/events", (req: Request, res: Response) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const id = broadcaster.addClient(res);
    // Keep-alive heartbeat every 25s — proxies (and some browsers) close
    // idle SSE streams after 30-60s.
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        /* will be cleaned up by close handler */
      }
    }, 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      broadcaster.removeClient(id);
    });
  });
}
