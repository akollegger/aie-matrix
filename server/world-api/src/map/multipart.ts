import type { IncomingMessage } from "node:http";
import { Effect } from "effect";
import { MultipartParseError } from "./map-errors.js";

// Minimal type stubs for busboy (no bundled types available)
interface BusboyFile {
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "end", listener: () => void): void;
}
interface BusboyInstance {
  on(event: "field", listener: (name: string, value: string) => void): void;
  on(event: "file", listener: (name: string, stream: BusboyFile) => void): void;
  on(event: "finish", listener: () => void): void;
  on(event: "error", listener: (err: unknown) => void): void;
  write(chunk: Buffer, encoding?: string): void;
  end(): void;
}

let _busboyFactory: ((opts: { headers: Record<string, string | string[]> }) => BusboyInstance) | undefined;

async function getBusboy(): Promise<(options: { headers: Record<string, string | string[]> }) => BusboyInstance> {
  if (!_busboyFactory) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import("busboy" as any);
    _busboyFactory = (mod.default ?? mod) as (opts: { headers: Record<string, string | string[]> }) => BusboyInstance;
  }
  return _busboyFactory;
}

/**
 * Parse a `multipart/form-data` request body, collecting the `mapId` field
 * and the `file` part as a Buffer.
 */
export function parseMultipart(
  req: IncomingMessage,
): Effect.Effect<{ mapId: string; fileBytes: Buffer }, MultipartParseError> {
  return Effect.async((resume) => {
    let mapId: string | undefined;
    const fileChunks: Buffer[] = [];
    let fileReceived = false;

    getBusboy()
      .then((busboyFactory) => {
        let bb: BusboyInstance;
        try {
          bb = busboyFactory({ headers: req.headers as Record<string, string | string[]> });
        } catch (e) {
          resume(Effect.fail(new MultipartParseError({ cause: e instanceof Error ? e.message : String(e) })));
          return;
        }

        bb.on("field", (name, value) => {
          if (name === "mapId") mapId = value.trim();
        });

        bb.on("file", (name, stream) => {
          if (name === "file") {
            fileReceived = true;
            stream.on("data", (chunk) => fileChunks.push(chunk));
          }
          stream.on("end", () => { /* wait for bb "finish" */ });
        });

        bb.on("finish", () => {
          if (!mapId) {
            resume(Effect.fail(new MultipartParseError({ cause: 'Missing required field "mapId"' })));
            return;
          }
          if (!fileReceived) {
            resume(Effect.fail(new MultipartParseError({ cause: 'Missing required file part "file"' })));
            return;
          }
          resume(Effect.succeed({ mapId, fileBytes: Buffer.concat(fileChunks) }));
        });

        bb.on("error", (e) => {
          resume(Effect.fail(new MultipartParseError({ cause: e instanceof Error ? e.message : String(e) })));
        });

        req.on("data", (chunk: Buffer) => bb.write(chunk));
        req.on("end", () => bb.end());
      })
      .catch((e) => {
        resume(Effect.fail(new MultipartParseError({ cause: e instanceof Error ? e.message : String(e) })));
      });
  });
}
