import { Storage } from "@google-cloud/storage";
import { Context, Data, Effect, Layer } from "effect";

export class GcsError extends Data.TaggedError("GcsError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface GcsOps {
  /** Upload bytes to `path` (e.g. `maps/foo.map.gram`) and return the public GCS URI. */
  upload(path: string, bytes: Buffer): Effect.Effect<string, GcsError>;
}

export class GcsService extends Context.Tag("aie-matrix/GcsService")<GcsService, GcsOps>() {}

/**
 * No-op GCS layer — returns a `gs://<bucket>/<path>` URI without actually uploading.
 * Used when `GCS_BUCKET` is unset (local / CI environments).
 */
export const makeNoOpGcsLayer = (bucket: string = "local"): Layer.Layer<GcsService> =>
  Layer.succeed(GcsService, {
    upload: (path) =>
      Effect.succeed(`gs://${bucket}/${path}`),
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
          const file = storage.bucket(bucket).file(path);
          await file.save(bytes, { resumable: false });
          return `gs://${bucket}/${path}`;
        },
        catch: (e) =>
          new GcsError({
            message: e instanceof Error ? e.message : String(e),
            cause: e,
          }),
      }),
  });

/** Build a GCS layer from environment variables. Falls back to no-op when `GCS_BUCKET` is unset. */
export function makeGcsLayerFromEnv(env: NodeJS.ProcessEnv = process.env): Layer.Layer<GcsService> {
  const bucket = env.GCS_BUCKET?.trim();
  if (!bucket) {
    return makeNoOpGcsLayer();
  }
  return makeLiveGcsLayer(bucket);
}
