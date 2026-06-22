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
  /**
   * RFC-0019 — register a mini-game session host (Barnacle Protocol
   * conformer). Unlike `register`, this does NOT fetch or validate an
   * AgentCard — mini-games speak Barnacle, not A2A-agent. The entry
   * declares which `platformClasses` (world-item types) the mini-game
   * claims; the supervisor uses that to route handoffs.
   */
  readonly registerMiniGame: (input: {
    agentId: string;
    baseUrl: string;
    platformClasses: ReadonlyArray<string>;
    hardTimeoutMs?: number;
    builtIn: boolean;
    about?: string;
  }) => Effect.Effect<CatalogEntry, AgentAlreadyRegistered>;
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
  /** Look up the mini-game catalog entry that claims a given platform class.
   *  Returns the first match (v1 forbids two mini-games claiming the same
   *  class). Returns `undefined` if no mini-game is registered for it. */
  readonly findMiniGameForPlatformClass: (platformClass: string) => Effect.Effect<
    | (Extract<CatalogEntry, { kind: "mini-game" }>)
    | undefined
  >;
  readonly deregister: (agentId: string) => Effect.Effect<void, AgentNotFound>;
}

export class CatalogService extends Context.Tag("agent-host/CatalogService")<
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
      const b = normalizeBaseUrl(baseUrl);
      const disk = yield* this.load();
      const existing = disk.agents[agentId];
      // Re-registration from the SAME baseUrl is an UPSERT: the agent restarted
      // with a new agent card — refresh the catalog so changes go live without
      // manual catalog.json edits.
      // Re-registration from a DIFFERENT baseUrl is also allowed as an UPSERT:
      // this is the Kubernetes rolling-deploy case where a new pod uses the same
      // stable AGENT_ID but has a new pod IP. The new entry replaces the old one;
      // the old pod deregisters on SIGTERM and its ghost tasks fail out naturally.
      if (existing && existing.kind === "mini-game") {
        // A mini-game owns this id; the agent register path can't
        // overwrite it. Surface as already-registered (the only error
        // shape this method can fail with for collisions).
        return yield* Effect.fail(new AgentAlreadyRegistered({ agentId }));
      }
      const cardUrl = `${b}/.well-known/agent-card.json`;
      const raw = yield* fetchJson(cardUrl);
      const v = parseAndValidateAgentCard(raw);
      if (!v.ok) {
        return yield* Effect.fail(
          new AgentCardInvalid({ message: "validation failed", fieldErrors: v.errors }),
        );
      }
      const entry: CatalogEntry = {
        kind: "agent",
        agentId,
        baseUrl: b,
        agentCard: v.value as unknown as Extract<
          CatalogEntry,
          { kind?: "agent" }
        >["agentCard"],
        registeredAt: new Date().toISOString(),
        builtIn,
      };
      const next: CatalogFile = { agents: { ...disk.agents, [agentId]: entry } };
      yield* this.save(next);
      return entry;
    });

  registerMiniGame = (input: {
    agentId: string;
    baseUrl: string;
    platformClasses: ReadonlyArray<string>;
    hardTimeoutMs?: number;
    builtIn: boolean;
    about?: string;
  }): Effect.Effect<CatalogEntry, AgentAlreadyRegistered> =>
    Effect.gen(this, function* () {
      const { agentId, baseUrl, platformClasses, hardTimeoutMs, builtIn, about } = input;
      const disk = yield* this.load();
      if (disk.agents[agentId]) {
        return yield* Effect.fail(new AgentAlreadyRegistered({ agentId }));
      }
      const entry: CatalogEntry = {
        kind: "mini-game",
        agentId,
        baseUrl: normalizeBaseUrl(baseUrl),
        platformClasses: [...platformClasses],
        ...(hardTimeoutMs !== undefined ? { hardTimeoutMs } : {}),
        registeredAt: new Date().toISOString(),
        builtIn,
        ...(about !== undefined ? { about } : {}),
      };
      const next: CatalogFile = { agents: { ...disk.agents, [agentId]: entry } };
      yield* this.save(next);
      return entry;
    });

  findMiniGameForPlatformClass = (
    platformClass: string,
  ): Effect.Effect<
    Extract<CatalogEntry, { kind: "mini-game" }> | undefined
  > =>
    Effect.gen(this, function* () {
      const disk = yield* this.load();
      for (const e of Object.values(disk.agents)) {
        if (e.kind === "mini-game" && e.platformClasses.includes(platformClass)) {
          return e;
        }
      }
      return undefined;
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
        if (e.kind === "mini-game") {
          return {
            agentId: e.agentId,
            baseUrl: e.baseUrl,
            tier: "mini-game",
            builtIn: e.builtIn,
            about: e.about ?? `mini-game; serves ${e.platformClasses.join(", ")}`,
          };
        }
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
