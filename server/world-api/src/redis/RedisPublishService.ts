import type { Redis } from "ioredis";
import { Context, Effect, Layer } from "effect";

export interface RedisPublishOps {
  /** Publish a JSON-serializable event to a Redis pub/sub channel. */
  publish(channel: string, event: unknown): Effect.Effect<void, never>;
}

export class RedisPublishService extends Context.Tag("aie-matrix/RedisPublishService")<
  RedisPublishService,
  RedisPublishOps
>() {}

/** No-op layer — silently drops all publish calls. Used when Redis is not configured. */
export const makeNoOpRedisPublishLayer: Layer.Layer<RedisPublishService> = Layer.succeed(
  RedisPublishService,
  {
    publish: () => Effect.void,
  },
);

/** Live layer backed by an existing `ioredis` `Redis` client. */
export const makeLiveRedisPublishLayer = (redis: Redis): Layer.Layer<RedisPublishService> =>
  Layer.succeed(RedisPublishService, {
    publish: (channel, event) =>
      Effect.promise(async () => {
        await redis.publish(channel, JSON.stringify(event));
      }),
  });

/** Build a Redis publish layer from environment variables. Falls back to no-op when `REDIS_URL` is unset. */
export async function makeRedisPublishLayerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Layer.Layer<RedisPublishService>> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    return makeNoOpRedisPublishLayer;
  }
  // Dynamic import — ioredis is a CJS module, use named import
  const ioredis = await import("ioredis");
  // ioredis default export is the Redis class
  const RedisClass = ioredis.default ?? (ioredis as unknown as { Redis: new (url: string, opts?: object) => Redis }).Redis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: Redis = new (RedisClass as any)(redisUrl, { lazyConnect: true }) as Redis;
  await client.connect();
  return makeLiveRedisPublishLayer(client);
}
