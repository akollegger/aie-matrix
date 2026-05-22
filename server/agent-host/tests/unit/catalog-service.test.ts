import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect, Exit, Cause, Option } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CatalogServiceImpl } from "../../src/catalog/CatalogService.js";
import {
  AgentAlreadyRegistered,
  AgentCardFetchFailed,
  AgentCardInvalid,
  AgentNotFound,
} from "../../src/errors.js";
import type { CatalogEntry } from "../../src/types.js";

// Minimal valid IC-001 agent card (matches catalog-schema.test.ts sample)
const VALID_CARD = {
  name: "test-agent",
  description: "A test agent",
  protocolVersion: "0.3.0",
  version: "0.0.1",
  url: "http://127.0.0.1:4001",
  capabilities: { streaming: true, pushNotifications: false },
  skills: [{ id: "s1", name: "Skill One", description: "Does something" }],
  defaultInputModes: ["text"],
  defaultOutputModes: ["text"],
  matrix: {
    schemaVersion: 1,
    tier: "wanderer",
    ghostClasses: ["any"],
    requiredTools: ["whereami", "exits", "go"],
    capabilitiesRequired: [],
    memoryKind: "none",
    llmProvider: "none",
    profile: { about: "A test ghost" },
    authors: ["test"],
  },
};

const SEEDED_ENTRY: CatalogEntry = {
  agentId: "existing-agent",
  baseUrl: "http://127.0.0.1:4001",
  agentCard: VALID_CARD as unknown as CatalogEntry["agentCard"],
  registeredAt: "2024-01-01T00:00:00.000Z",
  builtIn: false,
};

let tmpDir: string;
let catalogPath: string;
let svc: CatalogServiceImpl;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "catalog-test-"));
  catalogPath = join(tmpDir, "catalog.json");
  svc = new CatalogServiceImpl(catalogPath);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmpDir, { recursive: true, force: true });
});

function stubFetch(response: object | "network-error" | "http-error"): void {
  if (response === "network-error") {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
  } else if (response === "http-error") {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  } else {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(response) }),
    );
  }
}

async function seedCatalog(agents: Record<string, CatalogEntry>): Promise<void> {
  await writeFile(catalogPath, JSON.stringify({ agents }, null, 2), "utf8");
}

// Runs an Effect and returns the typed failure; throws if the effect succeeds.
async function expectFail<E>(effect: Effect.Effect<unknown, E>): Promise<E> {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) {
    throw new Error("Expected effect to fail but it succeeded");
  }
  const opt = Cause.failureOption(exit.cause);
  if (!Option.isSome(opt)) {
    throw new Error("Expected a typed failure but got a defect");
  }
  return opt.value;
}

describe("CatalogServiceImpl", () => {
  describe("register()", () => {
    it("succeeds when agent-card endpoint returns a valid card", async () => {
      stubFetch(VALID_CARD);
      const entry = await Effect.runPromise(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      expect(entry.agentId).toBe("test-agent");
      expect(entry.baseUrl).toBe("http://127.0.0.1:4001");
      expect(entry.builtIn).toBe(false);
      expect(typeof entry.registeredAt).toBe("string");
    });

    it("fetches card from <baseUrl>/.well-known/agent-card.json", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(VALID_CARD) });
      vi.stubGlobal("fetch", mockFetch);
      await Effect.runPromise(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:4001/.well-known/agent-card.json",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("normalizes trailing slash from baseUrl", async () => {
      stubFetch(VALID_CARD);
      const entry = await Effect.runPromise(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001/", builtIn: false }),
      );
      expect(entry.baseUrl).toBe("http://127.0.0.1:4001");
    });

    it("persists the entry to the catalog file", async () => {
      stubFetch(VALID_CARD);
      await Effect.runPromise(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      // A fresh service instance reads back the persisted entry
      const fresh = new CatalogServiceImpl(catalogPath);
      const entry = await Effect.runPromise(fresh.get("test-agent"));
      expect(entry.agentId).toBe("test-agent");
    });

    it("fails with AgentCardFetchFailed when the endpoint is unreachable", async () => {
      stubFetch("network-error");
      const err = await expectFail(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      expect(err).toBeInstanceOf(AgentCardFetchFailed);
    });

    it("fails with AgentCardFetchFailed and includes HTTP status on non-OK response", async () => {
      stubFetch("http-error");
      const err = await expectFail(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      expect(err).toBeInstanceOf(AgentCardFetchFailed);
      expect((err as AgentCardFetchFailed).status).toBe(404);
    });

    it("fails with AgentCardInvalid when the fetched card fails schema validation", async () => {
      stubFetch({ name: "incomplete" }); // missing required fields
      const err = await expectFail(
        svc.register({ agentId: "test-agent", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      expect(err).toBeInstanceOf(AgentCardInvalid);
    });

    it("fails with AgentAlreadyRegistered on duplicate agentId", async () => {
      await seedCatalog({ "existing-agent": SEEDED_ENTRY });
      stubFetch(VALID_CARD);
      const err = await expectFail(
        svc.register({
          agentId: "existing-agent",
          baseUrl: "http://127.0.0.1:4002",
          builtIn: false,
        }),
      );
      expect(err).toBeInstanceOf(AgentAlreadyRegistered);
      expect((err as AgentAlreadyRegistered).agentId).toBe("existing-agent");
    });

    it("fails with AgentCardInvalid for a URL-unsafe agentId", async () => {
      const err = await expectFail(
        svc.register({ agentId: "bad/id", baseUrl: "http://127.0.0.1:4001", builtIn: false }),
      );
      expect(err).toBeInstanceOf(AgentCardInvalid);
    });
  });

  describe("list()", () => {
    it("returns an empty array when the catalog has no entries", async () => {
      const result = await Effect.runPromise(svc.list());
      expect(result).toEqual([]);
    });

    it("returns the correct shape for a populated catalog", async () => {
      await seedCatalog({ "existing-agent": SEEDED_ENTRY });
      const result = await Effect.runPromise(svc.list());
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        agentId: "existing-agent",
        baseUrl: "http://127.0.0.1:4001",
        tier: "wanderer",
        builtIn: false,
        about: "A test ghost",
      });
    });

    it("returns 'unknown' tier and empty about when matrix is absent from agentCard", async () => {
      const noMatrix: CatalogEntry = {
        ...SEEDED_ENTRY,
        agentId: "bare-agent",
        agentCard: { name: "bare" } as unknown as CatalogEntry["agentCard"],
      };
      await seedCatalog({ "bare-agent": noMatrix });
      const result = await Effect.runPromise(svc.list());
      expect(result[0]).toMatchObject({ tier: "unknown", about: "" });
    });
  });

  describe("get()", () => {
    it("returns the entry for a known agentId", async () => {
      await seedCatalog({ "existing-agent": SEEDED_ENTRY });
      const entry = await Effect.runPromise(svc.get("existing-agent"));
      expect(entry.agentId).toBe("existing-agent");
      expect(entry.baseUrl).toBe("http://127.0.0.1:4001");
    });

    it("fails with AgentNotFound for an unknown agentId", async () => {
      const err = await expectFail(svc.get("ghost"));
      expect(err).toBeInstanceOf(AgentNotFound);
      expect((err as AgentNotFound).agentId).toBe("ghost");
    });
  });

  describe("deregister()", () => {
    it("removes an existing agent from the catalog", async () => {
      await seedCatalog({ "existing-agent": SEEDED_ENTRY });
      await Effect.runPromise(svc.deregister("existing-agent"));
      const err = await expectFail(svc.get("existing-agent"));
      expect(err).toBeInstanceOf(AgentNotFound);
    });

    it("does not affect other agents when deregistering one", async () => {
      const second: CatalogEntry = {
        ...SEEDED_ENTRY,
        agentId: "second-agent",
        baseUrl: "http://127.0.0.1:4002",
      };
      await seedCatalog({ "existing-agent": SEEDED_ENTRY, "second-agent": second });
      await Effect.runPromise(svc.deregister("existing-agent"));
      const remaining = await Effect.runPromise(svc.list());
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.agentId).toBe("second-agent");
    });

    it("fails with AgentNotFound for an unknown agentId", async () => {
      const err = await expectFail(svc.deregister("ghost"));
      expect(err).toBeInstanceOf(AgentNotFound);
      expect((err as AgentNotFound).agentId).toBe("ghost");
    });
  });
});
