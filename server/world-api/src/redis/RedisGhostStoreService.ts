import type { Redis } from "ioredis";
import { Context, Effect, Layer } from "effect";

const GHOST_KEY_PREFIX = "ghost:";
const GHOST_TTL_SECONDS = 60 * 60 * 8; // 8 hours — matches JWT TTL

export interface GhostStoreRecord {
  ghostId: string;
  agentId?: string;
  h3Index: string;
  status: "active" | "stopped";
  caretakerId?: string;
  createdAt: string;
}

export interface RedisGhostStoreOps {
  set(ghostId: string, record: GhostStoreRecord): Effect.Effect<void, never>;
  get(ghostId: string): Effect.Effect<GhostStoreRecord | null, never>;
  del(ghostId: string): Effect.Effect<void, never>;
}

export class RedisGhostStoreService extends Context.Tag("aie-matrix/RedisGhostStoreService")<
  RedisGhostStoreService,
  RedisGhostStoreOps
>() {}

export const makeNoOpRedisGhostStoreLayer: Layer.Layer<RedisGhostStoreService> = Layer.succeed(
  RedisGhostStoreService,
  {
    set: () => Effect.void,
    get: () => Effect.succeed(null),
    del: () => Effect.void,
  },
);

export const makeLiveRedisGhostStoreLayer = (redis: Redis): Layer.Layer<RedisGhostStoreService> =>
  Layer.succeed(RedisGhostStoreService, {
    set: (ghostId, record) =>
      Effect.promise(async () => {
        await redis.set(
          `${GHOST_KEY_PREFIX}${ghostId}`,
          JSON.stringify(record),
          "EX",
          GHOST_TTL_SECONDS,
        );
      }),
    get: (ghostId) =>
      Effect.promise(async () => {
        const raw = await redis.get(`${GHOST_KEY_PREFIX}${ghostId}`);
        if (!raw) return null;
        try { return JSON.parse(raw) as GhostStoreRecord; } catch { return null; }
      }),
    del: (ghostId) =>
      Effect.promise(async () => { await redis.del(`${GHOST_KEY_PREFIX}${ghostId}`); }),
  });

export async function makeRedisGhostStoreLayerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Layer.Layer<RedisGhostStoreService>> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) return makeNoOpRedisGhostStoreLayer;
  const ioredis = await import("ioredis");
  const RedisClass = ioredis.default ?? (ioredis as unknown as { Redis: new (url: string, opts?: object) => Redis }).Redis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: Redis = new (RedisClass as any)(redisUrl, { lazyConnect: true, enableOfflineQueue: false }) as Redis;
  await client.connect();
  return makeLiveRedisGhostStoreLayer(client);
}
