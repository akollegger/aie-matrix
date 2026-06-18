import type { Redis } from "ioredis";
import { Effect, Layer } from "effect";
import type { CatalogFile, ICatalogService } from "./CatalogService.js";
import { CatalogService, CatalogServiceImpl } from "./CatalogService.js";
import {
  AgentAlreadyRegistered,
  AgentCardFetchFailed,
  AgentCardInvalid,
  AgentNotFound,
} from "../errors.js";

const CATALOG_REDIS_KEY = "agent-host:catalog";
const CATALOG_TTL_SECONDS = 60 * 60 * 24; // 24 hours

function emptyCatalog(): CatalogFile {
  return { agents: {} };
}

/**
 * Redis-backed catalog implementation. Stores the entire CatalogFile as a
 * single JSON blob in one Redis key (simpler than HMSET per-entry given
 * the catalog is small). Falls back to empty catalog on any Redis error so
 * a connectivity blip does not crash agent-host startup.
 *
 * All write operations are best-effort: a Redis save error is logged but
 * does NOT propagate — the in-memory catalog continues working normally.
 */
export class RedisCatalogServiceImpl implements ICatalogService {
  private readonly redisKey: string;
  // Serialises all write-path operations within this process so concurrent
  // registrations cannot race (load → mutate → save) against each other.
  private _writeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly redis: Redis,
    redisKey: string = CATALOG_REDIS_KEY,
  ) {
    this.redisKey = redisKey;
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this._writeLock;
    let release!: () => void;
    this._writeLock = new Promise<void>((resolve) => { release = resolve; });
    return previous.then(() => fn()).finally(release);
  }

  load = (): Effect.Effect<CatalogFile> =>
    Effect.promise(async () => {
      try {
        const raw = await this.redis.get(this.redisKey);
        if (!raw) return emptyCatalog();
        const parsed = JSON.parse(raw) as CatalogFile;
        if (!parsed || typeof parsed !== "object" || !parsed.agents) {
          return emptyCatalog();
        }
        console.log(
          JSON.stringify({
            event: "agent-host.catalog.redis-restore",
            count: Object.keys(parsed.agents).length,
          }),
        );
        return parsed;
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.message?.includes("ECONNREFUSED") ||
            e instanceof Error) {
          // Non-fatal: return empty catalog so startup continues
          console.log(
            JSON.stringify({
              event: "agent-host.catalog.redis-restore-empty",
              reason: e instanceof Error ? e.message : String(e),
            }),
          );
        }
        return emptyCatalog();
      }
    });

  save = (c: CatalogFile): Effect.Effect<void> =>
    Effect.promise(async () => {
      try {
        await this.redis.set(
          this.redisKey,
          JSON.stringify(c),
          "EX",
          CATALOG_TTL_SECONDS,
        );
      } catch (e) {
        // Non-fatal — log structured event, do not propagate
        console.log(
          JSON.stringify({
            event: "agent-host.catalog.redis-save-error",
            reason: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    });

  // Build a CatalogServiceImpl whose load/save are patched to use Redis.
  // Since CatalogServiceImpl stores all methods as arrow-function instance
  // properties, we construct a real instance (with a dummy path) then
  // overwrite the two I/O methods before the instance is used.
  private delegate(): CatalogServiceImpl {
    const d = new CatalogServiceImpl("__redis__");
    d.load = this.load;
    d.save = this.save;
    return d;
  }

  register = (input: {
    agentId: string;
    baseUrl: string;
    builtIn: boolean;
  }): Effect.Effect<
    import("../types.js").CatalogEntry,
    AgentCardInvalid | AgentAlreadyRegistered | AgentCardFetchFailed
  > => Effect.promise(() => this.withLock(() => Effect.runPromise(this.delegate().register(input))));

  registerMiniGame = (input: {
    agentId: string;
    baseUrl: string;
    platformClasses: ReadonlyArray<string>;
    hardTimeoutMs?: number;
    builtIn: boolean;
    about?: string;
  }): Effect.Effect<import("../types.js").CatalogEntry, AgentAlreadyRegistered> =>
    Effect.promise(() => this.withLock(() => Effect.runPromise(this.delegate().registerMiniGame(input))));

  list = (): Effect.Effect<
    ReadonlyArray<{
      agentId: string;
      baseUrl: string;
      tier: string;
      builtIn: boolean;
      about: string;
    }>
  > => this.delegate().list();

  get = (agentId: string): Effect.Effect<import("../types.js").CatalogEntry, AgentNotFound> =>
    this.delegate().get(agentId);

  findMiniGameForPlatformClass = (
    platformClass: string,
  ): Effect.Effect<
    Extract<import("../types.js").CatalogEntry, { kind: "mini-game" }> | undefined
  > => this.delegate().findMiniGameForPlatformClass(platformClass);

  deregister = (agentId: string): Effect.Effect<void, AgentNotFound> =>
    Effect.promise(() => this.withLock(() => Effect.runPromise(this.delegate().deregister(agentId))));
}

export const makeRedisCatalogLayer = (redis: Redis): Layer.Layer<CatalogService> =>
  Layer.succeed(CatalogService, new RedisCatalogServiceImpl(redis));

/**
 * Build a CatalogService Layer from environment:
 * - If REDIS_URL is set: use Redis-backed catalog
 * - Otherwise: fall back to file-backed catalog at `fallbackFilePath`
 */
export async function makeRedisCatalogLayerFromEnv(
  fallbackFilePath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Layer.Layer<CatalogService>> {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    // Import file-backed layer lazily to keep the fallback path clean
    const { CatalogServiceLive } = await import("./CatalogService.js");
    return CatalogServiceLive(fallbackFilePath);
  }
  const ioredis = await import("ioredis");
  const RedisClass =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ioredis as any).default ?? (ioredis as unknown as { Redis: new (url: string, opts?: object) => Redis }).Redis;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: Redis = new (RedisClass as any)(redisUrl, { lazyConnect: true }) as Redis;
  await client.connect();
  return makeRedisCatalogLayer(client);
}
