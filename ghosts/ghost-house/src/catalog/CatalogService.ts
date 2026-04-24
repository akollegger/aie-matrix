import { Context, Effect, Layer } from "effect";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { CatalogEntry } from "../types.js";
import {
  AgentAlreadyRegistered,
  AgentCardFetchFailed,
  AgentCardInvalid,
  AgentNotFound,
} from "../errors.js";
import { isUrlSafeAgentId, parseAndValidateAgentCard } from "./agent-card-schema.js";

export type CatalogFile = {
  readonly agents: Record<string, CatalogEntry>;
};

const FETCH_TIMEOUT_MS = 15_000;

export interface ICatalogService {
  readonly load: () => Effect.Effect<CatalogFile>;
  readonly save: (c: CatalogFile) => Effect.Effect<void>;
  readonly register: (input: {
    agentId: string;
    baseUrl: string;
    builtIn: boolean;
  }) => Effect.Effect<CatalogEntry, AgentCardInvalid | AgentAlreadyRegistered | AgentCardFetchFailed>;
  readonly list: () => Effect.Effect<
    ReadonlyArray<{
      agentId: string;
      baseUrl: string;
      tier: string;
      builtIn: boolean;
      about: string;
    }>
  >;
  readonly get: (agentId: string) => Effect.Effect<CatalogEntry, AgentNotFound>;
  readonly deregister: (agentId: string) => Effect.Effect<void, AgentNotFound>;
}

export class CatalogService extends Context.Tag("ghost-house/CatalogService")<
  CatalogService,
  ICatalogService
>() {}

function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/$/, "");
}

function fetchJson(url: string): Effect.Effect<unknown, AgentCardFetchFailed> {
  return Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        throw new AgentCardFetchFailed({ url, message: `HTTP ${res.status}`, status: res.status });
      }
      return (await res.json()) as unknown;
    },
    catch: (e) =>
      e instanceof AgentCardFetchFailed
        ? e
        : new AgentCardFetchFailed({ url, message: e instanceof Error ? e.message : String(e) }),
  });
}

function emptyCatalog(): CatalogFile {
  return { agents: {} };
}

export class CatalogServiceImpl implements ICatalogService {
  constructor(private readonly catalogFilePath: string) {}

  load = (): Effect.Effect<CatalogFile> =>
    Effect.tryPromise({
      try: async () => {
        if (!existsSync(this.catalogFilePath)) {
          return emptyCatalog();
        }
        const raw = await readFile(this.catalogFilePath, "utf8");
        try {
          const j = JSON.parse(raw) as CatalogFile;
          if (!j || typeof j !== "object" || j.agents === undefined) {
            return emptyCatalog();
          }
          return j;
        } catch {
          return emptyCatalog();
        }
      },
      catch: () => new Error("catalog read failed"),
    }).pipe(Effect.orDie);

  save = (c: CatalogFile): Effect.Effect<void> =>
    Effect.tryPromise({
      try: () => writeFile(this.catalogFilePath, JSON.stringify(c, null, 2) + "\n", "utf8"),
      catch: () => new Error("catalog save failed"),
    }).pipe(Effect.orDie);

  register = (input: {
    agentId: string;
    baseUrl: string;
    builtIn: boolean;
  }): Effect.Effect<CatalogEntry, AgentCardInvalid | AgentAlreadyRegistered | AgentCardFetchFailed> =>
    Effect.gen(this, function* () {
      const { agentId, baseUrl, builtIn } = input;
      if (!isUrlSafeAgentId(agentId)) {
        return yield* Effect.fail(new AgentCardInvalid({ message: "invalid agentId" }));
      }
      const disk = yield* this.load();
      if (disk.agents[agentId]) {
        return yield* Effect.fail(new AgentAlreadyRegistered({ agentId }));
      }
      const b = normalizeBaseUrl(baseUrl);
      const cardUrl = `${b}/.well-known/agent-card.json`;
      const raw = yield* fetchJson(cardUrl);
      const v = parseAndValidateAgentCard(raw);
      if (!v.ok) {
        return yield* Effect.fail(
          new AgentCardInvalid({ message: "validation failed", fieldErrors: v.errors }),
        );
      }
      const entry: CatalogEntry = {
        agentId,
        baseUrl: b,
        agentCard: v.value as unknown as CatalogEntry["agentCard"],
        registeredAt: new Date().toISOString(),
        builtIn,
      };
      const next: CatalogFile = { agents: { ...disk.agents, [agentId]: entry } };
      yield* this.save(next);
      return entry;
    });

  list = (): Effect.Effect<
    ReadonlyArray<{
      agentId: string;
      baseUrl: string;
      tier: string;
      builtIn: boolean;
      about: string;
    }>
  > =>
    Effect.gen(this, function* () {
      const disk = yield* this.load();
      return Object.values(disk.agents).map((e) => {
        const ac = e.agentCard as { matrix?: { tier?: string; profile?: { about?: string } } };
        const matrix = ac.matrix;
        return {
          agentId: e.agentId,
          baseUrl: e.baseUrl,
          tier: matrix?.tier ?? "unknown",
          builtIn: e.builtIn,
          about: matrix?.profile?.about ?? "",
        };
      });
    });

  get = (agentId: string): Effect.Effect<CatalogEntry, AgentNotFound> =>
    Effect.gen(this, function* () {
      const disk = yield* this.load();
      const e = disk.agents[agentId];
      if (!e) {
        return yield* Effect.fail(new AgentNotFound({ agentId }));
      }
      return e;
    });

  deregister = (agentId: string): Effect.Effect<void, AgentNotFound> =>
    Effect.gen(this, function* () {
      const disk = yield* this.load();
      if (!disk.agents[agentId]) {
        return yield* Effect.fail(new AgentNotFound({ agentId }));
      }
      const { [agentId]: _removed, ...rest } = disk.agents;
      yield* this.save({ agents: rest });
    });
}

export const createCatalogService = (catalogFilePath: string): ICatalogService =>
  new CatalogServiceImpl(catalogFilePath);

export const CatalogServiceLive = (catalogFilePath: string): Layer.Layer<CatalogService> =>
  Layer.succeed(CatalogService, createCatalogService(catalogFilePath));
