import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  BARNACLE_COMPLETE_SCHEMA,
  BARNACLE_HANDOFF_SCHEMA,
  type BarnacleHandoffAck,
} from "@aie-matrix/shared-types";
import { makeBarnacleSupervisor } from "../../src/barnacle/BarnacleSupervisorService.js";
import type { ICatalogService } from "../../src/catalog/CatalogService.js";
import type { CatalogEntry } from "../../src/types.js";

/** Minimal fake catalog — only `findMiniGameForPlatformClass` is used. */
function fakeCatalog(miniGame: CatalogEntry | null): ICatalogService {
  return {
    load: () => Effect.succeed({ agents: {} }),
    save: () => Effect.succeed(undefined),
    register: () => Effect.die(new Error("not used")),
    registerMiniGame: () => Effect.die(new Error("not used")),
    list: () => Effect.succeed([]),
    get: () => Effect.die(new Error("not used")),
    deregister: () => Effect.die(new Error("not used")),
    findMiniGameForPlatformClass: () =>
      Effect.succeed(
        miniGame && miniGame.kind === "mini-game" ? miniGame : undefined,
      ),
  };
}

function makeFetchMock(
  scripted: Array<{ urlMatch: RegExp; reply: unknown; status?: number }>,
): (input: unknown, init?: unknown) => Promise<Response> {
  let cursor = 0;
  return async (input) => {
    const url = String(input);
    // Try in order. Re-usable matchers stay matchable; one-shots get consumed.
    for (let i = cursor; i < scripted.length; i++) {
      const s = scripted[i]!;
      if (s.urlMatch.test(url)) {
        cursor = i + 1;
        const status = s.status ?? 200;
        return new Response(JSON.stringify(s.reply), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    throw new Error(`unmocked fetch: ${url}`);
  };
}

describe("BarnacleSupervisor", () => {
  let supervisor: ReturnType<typeof makeBarnacleSupervisor>;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    supervisor?.stop();
    vi.useRealTimers();
    globalThis.fetch = origFetch;
  });

  it("beginSession fails fast when no mini-game claims the platform class", async () => {
    supervisor = makeBarnacleSupervisor({
      catalog: fakeCatalog(null),
      registryBaseUrl: "http://127.0.0.1:8787",
      devToken: "test-token",
      publicSupervisorA2A: "http://127.0.0.1:4000/v1/internal/barnacle-complete",
    });
    const result = await Effect.runPromise(
      supervisor.beginSession({
        ghostId: "g1",
        displayName: "Test",
        personality: {},
        worldCredential: { token: "t", worldApiBaseUrl: "http://127.0.0.1:8787" },
        spawnCell: "8f283082aa20c00",
        platformId: "PokerTable:cb0",
        platformClass: "PokerTable",
        peppersBaseUrl: "http://127.0.0.1:4002",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("no-mini-game-for-class");
    }
    expect(supervisor.listActiveSessions()).toHaveLength(0);
  });

  it("onCompleteReceived for an unknown session is a no-op (logged, not thrown)", async () => {
    supervisor = makeBarnacleSupervisor({
      catalog: fakeCatalog(null),
      registryBaseUrl: "http://127.0.0.1:8787",
      devToken: "test-token",
      publicSupervisorA2A: "http://127.0.0.1:4000/v1/internal/barnacle-complete",
    });
    await Effect.runPromise(
      supervisor.onCompleteReceived({
        schema: BARNACLE_COMPLETE_SCHEMA,
        sessionId: "never-existed",
        ghostId: "g1",
        lastEventIso: new Date().toISOString(),
      }),
    );
    // No exception = pass.
    expect(supervisor.listActiveSessions()).toHaveLength(0);
  });

  it("handoff failure (network error) leaves the world unchanged", async () => {
    const miniGame: CatalogEntry = {
      kind: "mini-game",
      agentId: "rdc-poker-bart",
      baseUrl: "http://127.0.0.1:4030",
      platformClasses: ["PokerTable"],
      registeredAt: new Date().toISOString(),
      builtIn: false,
    };
    // Script: withdraw OK; (pause/handoff fail mock — handled below); respawn OK
    let withdrawCalls = 0;
    let respawnCalls = 0;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes("/withdraw")) {
        withdrawCalls += 1;
        return new Response(JSON.stringify({ withdrawn: true }), { status: 200 });
      }
      if (url.includes("/respawn")) {
        respawnCalls += 1;
        return new Response(JSON.stringify({ h3Index: "8f...c00" }), {
          status: 200,
        });
      }
      // Pause and handoff go through the A2A client, not fetch.
      throw new Error(`unmocked fetch: ${url}`);
    }) as typeof fetch;

    supervisor = makeBarnacleSupervisor({
      catalog: fakeCatalog(miniGame),
      registryBaseUrl: "http://127.0.0.1:8787",
      devToken: "test-token",
      publicSupervisorA2A: "http://127.0.0.1:4000/v1/internal/barnacle-complete",
    });

    // Pause uses the A2A client which will fail because there's no peppers
    // listening — the supervisor should then call respawn to revert the
    // withdraw and return a `pause-failed` reason.
    const result = await Effect.runPromise(
      supervisor.beginSession({
        ghostId: "g1",
        displayName: "Test",
        personality: {},
        worldCredential: { token: "t", worldApiBaseUrl: "http://127.0.0.1:8787" },
        spawnCell: "8f283082aa20c00",
        platformId: "PokerTable:cb0",
        platformClass: "PokerTable",
        peppersBaseUrl: "http://127.0.0.1:1", // unreachable port
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("pause-failed");
    }
    expect(withdrawCalls).toBe(1);
    // Revert: respawn should have been called after the failed pause.
    expect(respawnCalls).toBeGreaterThanOrEqual(1);
    expect(supervisor.listActiveSessions()).toHaveLength(0);
  });
});
