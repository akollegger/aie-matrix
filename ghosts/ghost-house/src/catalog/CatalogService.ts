import { Layer, Context } from "effect";
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
  readonly load: () => Promise<CatalogFile>;
  readonly save: (c: CatalogFile) => Promise<void>;
  readonly register: (input: { agentId: string; baseUrl: string; builtIn: boolean }) => Promise<CatalogEntry>;
  readonly list: () => Promise<
    ReadonlyArray<{
      agentId: string;
      baseUrl: string;
      tier: string;
      builtIn: boolean;
      about: string;
    }>
  >;
  readonly get: (agentId: string) => Promise<CatalogEntry>;
  readonly deregister: (agentId: string) => Promise<void>;
}

export class CatalogService extends Context.Tag("ghost-house/CatalogService")<
  CatalogService,
  ICatalogService
>() {}

function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/$/, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new AgentCardFetchFailed({
      url,
      message: `HTTP ${res.status}`,
      status: res.status,
    });
  }
  return (await res.json()) as unknown;
}

function emptyCatalog(): CatalogFile {
  return { agents: {} };
}

export class CatalogServiceImpl implements ICatalogService {
  constructor(private readonly catalogFilePath: string) {}

  load = async (): Promise<CatalogFile> => {
    if (!existsSync(this.catalogFilePath)) {
      return emptyCatalog();
    }
    const raw = await readFile(this.catalogFilePath, "utf8");
    const j = JSON.parse(raw) as CatalogFile;
    if (!j || typeof j !== "object" || j.agents === undefined) {
      return emptyCatalog();
    }
    return j;
  };

  save = async (c: CatalogFile) => {
    await writeFile(this.catalogFilePath, JSON.stringify(c, null, 2) + "\n", "utf8");
  };

  register = async (input: { agentId: string; baseUrl: string; builtIn: boolean }) => {
    const { agentId, baseUrl, builtIn } = input;
    if (!isUrlSafeAgentId(agentId)) {
      throw new AgentCardInvalid({ message: "invalid agentId" });
    }
    const disk = await this.load();
    if (disk.agents[agentId]) {
      throw new AgentAlreadyRegistered({ agentId });
    }
    const b = normalizeBaseUrl(baseUrl);
    const cardUrl = `${b}/.well-known/agent-card.json`;
    let raw: unknown;
    try {
      raw = await fetchJson(cardUrl);
    } catch (e) {
      if (e instanceof AgentCardFetchFailed) {
        throw e;
      }
      throw new AgentCardFetchFailed({
        url: cardUrl,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    const v = parseAndValidateAgentCard(raw);
    if (!v.ok) {
      throw new AgentCardInvalid({ message: "validation failed", fieldErrors: v.errors });
    }
      const entry: CatalogEntry = {
        agentId,
        baseUrl: b,
        agentCard: v.value as unknown as CatalogEntry["agentCard"],
        registeredAt: new Date().toISOString(),
        builtIn,
      };
    const next: CatalogFile = {
      agents: { ...disk.agents, [agentId]: entry },
    };
    await this.save(next);
    return entry;
  };

  list = async () => {
    const disk = await this.load();
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
  };

  get = async (agentId: string) => {
    const disk = await this.load();
    const e = disk.agents[agentId];
    if (!e) {
      throw new AgentNotFound({ agentId });
    }
    return e;
  };

  deregister = async (agentId: string) => {
    const disk = await this.load();
    if (!disk.agents[agentId]) {
      throw new AgentNotFound({ agentId });
    }
    const { [agentId]: _removed, ...rest } = disk.agents;
    await this.save({ agents: rest });
  };
}

export const createCatalogService = (catalogFilePath: string): ICatalogService => new CatalogServiceImpl(catalogFilePath);

export const CatalogServiceLive = (catalogFilePath: string): Layer.Layer<CatalogService> =>
  Layer.succeed(CatalogService, createCatalogService(catalogFilePath));
