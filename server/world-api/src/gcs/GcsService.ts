import { Storage } from "@google-cloud/storage";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Data, Effect, Layer } from "effect";

export class GcsError extends Data.TaggedError("GcsError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface GcsOps {
  upload(path: string, bytes: Buffer): Effect.Effect<string, GcsError>;
  download(path: string): Effect.Effect<Buffer, GcsError>;
}

export class GcsService extends Context.Tag("aie-matrix/GcsService")<GcsService, GcsOps>() {}

/**
 * Local-file stub — reads/writes under `baseDir`.
 * Used when `GCS_BUCKET` is unset (Tier 1 dev without GCS credentials).
 */
export const makeLocalGcsStubLayer = (baseDir: string): Layer.Layer<GcsService> =>
  Layer.succeed(GcsService, {
    upload: (path, bytes) =>
      Effect.tryPromise({
        try: async () => {
          const fullPath = join(baseDir, path);
          await fs.mkdir(dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, bytes);
          return `file://${fullPath}`;
        },
        catch: (e) => new GcsError({ message: e instanceof Error ? e.message : String(e), cause: e }),
      }),

    download: (path) =>
      Effect.tryPromise({
        try: () => fs.readFile(join(baseDir, path)),
        catch: (e) => new GcsError({ message: e instanceof Error ? e.message : String(e), cause: e }),
      }),
  });

/**
 * Live GCS layer backed by `@google-cloud/storage`.
 * Requires `GCS_BUCKET` env var (and ADC or `GOOGLE_APPLICATION_CREDENTIALS`).
 */
export const makeLiveGcsLayer = (bucket: string): Layer.Layer<GcsService> =>
  Layer.succeed(GcsService, {
    upload: (path, bytes) =>
      Effect.tryPromise({
        try: async () => {
          const storage = new Storage();
          await storage.bucket(bucket).file(path).save(bytes, { resumable: false });
          return `gs://${bucket}/${path}`;
        },
        catch: (e) => new GcsError({ message: e instanceof Error ? e.message : String(e), cause: e }),
      }),

    download: (path) =>
      Effect.tryPromise({
        try: async () => {
          const storage = new Storage();
          const [contents] = await storage.bucket(bucket).file(path).download();
          return contents as Buffer;
        },
        catch: (e) => new GcsError({ message: e instanceof Error ? e.message : String(e), cause: e }),
      }),
  });

const _repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Build a GCS layer from environment variables. Falls back to local-file stub when `GCS_BUCKET` is unset. */
export function makeGcsLayerFromEnv(env: NodeJS.ProcessEnv = process.env): Layer.Layer<GcsService> {
  const bucket = env.GCS_BUCKET?.trim();
  if (!bucket) {
    return makeLocalGcsStubLayer(join(_repoRoot, "tmp", "gcs"));
  }
  return makeLiveGcsLayer(bucket);
}
