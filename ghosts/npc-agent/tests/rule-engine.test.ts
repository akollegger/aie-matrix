import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import type { CharacterDefinition } from "../src/types.js";
import { GhostMcpService } from "../src/mcp-effect.js";
import { evaluateRules, buildSnapshot, type WorldSnapshot } from "../src/behavior/rule-engine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

type Call = { name: string; args: Record<string, unknown> };

function makeMcpLayer(
  overrides: Partial<{ go: () => unknown; take: () => unknown; traverse: () => unknown }> = {},
): { layer: Layer.Layer<GhostMcpService>; calls: Call[] } {
  const calls: Call[] = [];

  function track(name: string, args: Record<string, unknown> = {}, result: unknown = {}) {
    calls.push({ name, args });
    return Effect.succeed(result);
  }

  const layer = Layer.succeed(GhostMcpService, {
    whereami:             Effect.succeed({ h3Index: "8f2830828052d25", tileId: "8f2830828052d25", col: 0, row: 0 }),
    exits:                Effect.succeed({ exits: [] }),
    look:                 () => Effect.succeed({ tiles: [] }),
    go:                   (args) => overrides.go ? Effect.sync(overrides.go as () => unknown) as never
                                                 : track("go", args as Record<string, unknown>),
    take:                 (args) => overrides.take ? Effect.sync(overrides.take as () => unknown) as never
                                                   : track("take", args as Record<string, unknown>),
    traverse:             (args) => overrides.traverse ? Effect.sync(overrides.traverse as () => unknown) as never
                                                       : track("traverse", args as Record<string, unknown>),
    inventory:            Effect.succeed({ ok: true as const, objects: [], holdings: [] }),
    say:                  (args) => track("say", args as Record<string, unknown>, { message_id: "m1", mx_listeners: [] }),
    inbox:                Effect.succeed({ notifications: [] }),
    evalContractOpen:     (args) => track("evalContractOpen", args as Record<string, unknown>),
    evalContractEvaluate: (args) => track("evalContractEvaluate", args as Record<string, unknown>),
  });

  return { layer, calls };
}

function makeCharacter(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    id: "test-char",
    name: "Test Character",
    background: "A test character.",
    enabled: true,
    defaultAction: { do: "idle" },
    behaviorRules: [],
    dialogTree: { id: "dialog_1", nodes: new Map(), edges: [], rootId: "" },
    behaviorKind: "rule-engine" as const,
    ...overrides,
  };
}

const emptySnapshot: WorldSnapshot = {
  h3Index: "8f2830828052d25",
  occupants: [],
  exits: [{ toward: "n" }, { toward: "s" }],
  inventory: [],
  nearbyItems: [],
};

function run<A>(effect: Effect.Effect<A, unknown, GhostMcpService>, layer: Layer.Layer<GhostMcpService>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("evaluateRules", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("fires take when inventory_empty condition holds and item is here", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      inventory: [],
      nearbyItems: [{ id: "item-1", name: "Badge", at: "here" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "inventory_empty", action: { do: "take", item: "nearest" } }],
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "take")).toBe(true);
  });

  it("does not fire when inventory_empty is false (has items)", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      inventory: [{ itemRef: "item-1", name: "Badge" }],
      nearbyItems: [{ id: "item-2", name: "Pin", at: "here" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "inventory_empty", action: { do: "take", item: "nearest" } }],
      defaultAction: { do: "idle" },
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls).toHaveLength(0);
  });

  it("fires go when crowded (>=2 occupants)", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      occupants: ["ghost-a", "ghost-b"],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "crowded", action: { do: "go", toward: "random" } }],
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("does not fire crowded rule when only 1 occupant", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: ["ghost-a"] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "crowded", action: { do: "go", toward: "random" } }],
      defaultAction: { do: "idle" },
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(false);
  });

  it("always condition always fires", async () => {
    const { layer, calls } = makeMcpLayer();
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "always", action: { do: "go", toward: "random" } }],
    });
    await run(evaluateRules(char, emptySnapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("falls back to defaultAction when no rule matches", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: [] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "crowded", action: { do: "go", toward: "random" } }],
      defaultAction: { do: "go", toward: "random" },
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("idle defaultAction makes no MCP calls", async () => {
    const { layer, calls } = makeMcpLayer();
    const char = makeCharacter({ behaviorRules: [], defaultAction: { do: "idle" } });
    await run(evaluateRules(char, emptySnapshot), layer);
    expect(calls).toHaveLength(0);
  });

  it("skips rule on MCP failure and evaluates next rule", async () => {
    const calls: Call[] = [];
    let goCallCount = 0;

    const layer = Layer.succeed(GhostMcpService, {
      whereami:             Effect.succeed({ h3Index: "", tileId: "", col: 0, row: 0 }),
      exits:                Effect.succeed({ exits: [] }),
      look:                 () => Effect.succeed({ tiles: [] }),
      go:                   (args) => {
        calls.push({ name: "go", args: args as Record<string, unknown> });
        goCallCount++;
        return goCallCount === 1
          ? Effect.fail({ _tag: "McpCallError", tool: "go", cause: new Error("MCP error") } as never)
          : Effect.succeed({ ok: true as const, tileId: "abc" });
      },
      take:                 (args) => { calls.push({ name: "take", args: args as Record<string, unknown> }); return Effect.succeed({ ok: true as const, name: "x" }); },
      traverse:             (args) => { calls.push({ name: "traverse", args: args as Record<string, unknown> }); return Effect.succeed({ ok: true as const, via: "", from: "", to: "", tileClass: "" }); },
      inventory:            Effect.succeed({ ok: true as const, objects: [], holdings: [] }),
      say:                  (args) => { calls.push({ name: "say", args: args as Record<string, unknown> }); return Effect.succeed({ message_id: "m1", mx_listeners: [] }); },
      inbox:                Effect.succeed({ notifications: [] }),
      evalContractOpen:     (args) => { calls.push({ name: "evalContractOpen", args: args as Record<string, unknown> }); return Effect.succeed({ contractId: "c1" }); },
      evalContractEvaluate: (args) => { calls.push({ name: "evalContractEvaluate", args: args as Record<string, unknown> }); return Effect.succeed({ ok: true as const }); },
    });

    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: [] };
    const char = makeCharacter({
      behaviorRules: [
        { id: "r1", condition: "always", action: { do: "go", toward: "random" } },
        { id: "r2", condition: "always", action: { do: "idle" } },
      ],
    });

    await run(evaluateRules(char, snapshot), layer);
    expect(calls.filter((c) => c.name === "go")).toHaveLength(1);
  });

  it("alone condition fires when no occupants", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: [] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "alone", action: { do: "go", toward: "random" } }],
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("alone condition does not fire when occupants present", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: ["ghost-a"] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "alone", action: { do: "go", toward: "random" } }],
      defaultAction: { do: "idle" },
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(false);
  });

  it("item_adjacent condition fires go toward nearest_item", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      nearbyItems: [{ id: "item-1", name: "Badge", at: "n" }],
      exits: [{ toward: "n" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "item_adjacent", action: { do: "go", toward: "nearest_item" } }],
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "go")).toBe(true);
    expect(calls.find((c) => c.name === "go")?.args["toward"]).toBe("n");
  });

  it("item_here condition fires take on item at current tile", async () => {
    const { layer, calls } = makeMcpLayer();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      nearbyItems: [{ id: "item-1", name: "Badge", at: "here" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "item_here", action: { do: "take", item: "nearest" } }],
    });
    await run(evaluateRules(char, snapshot), layer);
    expect(calls.some((c) => c.name === "take")).toBe(true);
    expect(calls.find((c) => c.name === "take")?.args["itemRef"]).toBe("item-1");
  });
});

// ── buildSnapshot tests ───────────────────────────────────────────────────────

describe("buildSnapshot", () => {
  it("extracts h3Index from whereami response", () => {
    const s = buildSnapshot(
      { h3Index: "8f2830828052d25" }, { exits: [] }, { ok: true, objects: [], holdings: [] }, { tiles: [] }, "self-id"
    );
    expect(s.h3Index).toBe("8f2830828052d25");
  });

  it("falls back to tileId when h3Index absent", () => {
    const s = buildSnapshot({ tileId: "tile-abc" }, { exits: [] }, { ok: true, objects: [], holdings: [] }, { tiles: [] }, "self-id");
    expect(s.h3Index).toBe("tile-abc");
  });

  it("excludes self from occupants", () => {
    const s = buildSnapshot(
      { occupants: ["self-id", "other-ghost"] }, { exits: [] }, { ok: true, objects: [], holdings: [] }, { tiles: [] }, "self-id"
    );
    expect(s.occupants).toEqual(["other-ghost"]);
    expect(s.occupants).not.toContain("self-id");
  });

  it("parses exits array", () => {
    const s = buildSnapshot(
      {}, { exits: [{ toward: "n" }, { toward: "se" }] }, { ok: true, objects: [], holdings: [] }, { tiles: [] }, "self-id"
    );
    expect(s.exits).toHaveLength(2);
    expect(s.exits[0]!.toward).toBe("n");
  });

  it("parses inventory objects", () => {
    const s = buildSnapshot(
      {}, { exits: [] }, { ok: true, objects: [{ itemRef: "item-1", name: "Badge" }], holdings: [] }, { tiles: [] }, "self-id"
    );
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0]!.name).toBe("Badge");
  });

  it("extracts nearby items from look tiles", () => {
    const s = buildSnapshot(
      {}, { exits: [] }, { ok: true, objects: [], holdings: [] },
      { tiles: [{ at: "n", objects: [{ id: "item-1", name: "Token" }] }] },
      "self-id"
    );
    expect(s.nearbyItems).toHaveLength(1);
    expect(s.nearbyItems[0]!.at).toBe("n");
    expect(s.nearbyItems[0]!.name).toBe("Token");
  });
});
