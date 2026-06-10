import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import type { CharacterDefinition } from "../src/types.js";
import { evaluateRules, buildSnapshot, type WorldSnapshot } from "../src/behavior/rule-engine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMcp(): { client: GhostMcpClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      return {};
    }),
  } as unknown as GhostMcpClient;
  return { client, calls };
}

function makeCharacter(overrides: Partial<CharacterDefinition> = {}): CharacterDefinition {
  return {
    id: "test-char",
    name: "Test Character",
    background: "A test character.",
    enabled: true,
    defaultAction: "idle",
    behaviorRules: [],
    dialogTree: { nodes: new Map(), rootId: "", fallbackId: "" },
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("evaluateRules", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("fires seek-item when inventory_empty condition holds and item is nearby", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      inventory: [],
      nearbyItems: [{ id: "item-1", name: "Badge", at: "here" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "inventory_empty", action: "seek-item" }],
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "take")).toBe(true);
  });

  it("does not fire when inventory_empty is false (has items)", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      inventory: [{ itemRef: "item-1", name: "Badge" }],
      nearbyItems: [{ id: "item-2", name: "Pin", at: "here" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "inventory_empty", action: "seek-item" }],
      defaultAction: "idle",
    });
    await evaluateRules(char, snapshot, client);
    expect(calls).toHaveLength(0);
  });

  it("fires avoid-crowd when crowded (>=2 occupants)", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      occupants: ["ghost-a", "ghost-b"],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "crowded", action: "avoid-crowd" }],
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("does not fire crowded rule when only 1 occupant", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: ["ghost-a"] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "crowded", action: "avoid-crowd" }],
      defaultAction: "idle",
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "go")).toBe(false);
  });

  it("always condition always fires", async () => {
    const { client, calls } = makeMcp();
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "always", action: "wander" }],
    });
    await evaluateRules(char, emptySnapshot, client);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("falls back to defaultAction when no rule matches", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: [] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "crowded", action: "avoid-crowd" }],
      defaultAction: "wander",
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("idle and stay defaultAction make no MCP calls", async () => {
    for (const defaultAction of ["idle", "stay"] as const) {
      const { client, calls } = makeMcp();
      const char = makeCharacter({ behaviorRules: [], defaultAction });
      await evaluateRules(char, emptySnapshot, client);
      expect(calls).toHaveLength(0);
    }
  });

  it("skips rule on MCP failure and evaluates next rule", async () => {
    let callCount = 0;
    const calls: Array<{ name: string }> = [];
    const client = {
      callTool: vi.fn(async (name: string) => {
        calls.push({ name });
        callCount++;
        if (name === "go" && callCount === 1) {
          throw new Error("MCP error on first go");
        }
        return {};
      }),
    } as unknown as GhostMcpClient;

    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: [] };
    // Two always rules: first fires wander (throws), second fires idle (no-op)
    // The third rule (alone → wander) should fire after first two evaluated
    const char = makeCharacter({
      behaviorRules: [
        { id: "r1", condition: "always", action: "wander", priority: 1 },
        { id: "r2", condition: "always", action: "idle",   priority: 2 },
      ],
    });

    await evaluateRules(char, snapshot, client);
    // r1 fires wander → go throws → r1 skipped; r2 fires idle → no MCP call.
    // Only the one failed "go" call.
    expect(calls.filter((c) => c.name === "go")).toHaveLength(1);
  });

  it("alone condition fires when no occupants", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: [] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "alone", action: "wander" }],
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "go")).toBe(true);
  });

  it("alone condition does not fire when occupants present", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = { ...emptySnapshot, occupants: ["ghost-a"] };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "alone", action: "wander" }],
      defaultAction: "idle",
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "go")).toBe(false);
  });

  it("item_nearby condition fires when nearbyItems is non-empty", async () => {
    const { client, calls } = makeMcp();
    const snapshot: WorldSnapshot = {
      ...emptySnapshot,
      nearbyItems: [{ id: "item-1", name: "Badge", at: "n" }],
      exits: [{ toward: "n" }],
    };
    const char = makeCharacter({
      behaviorRules: [{ id: "r1", condition: "item_nearby", action: "seek-item" }],
    });
    await evaluateRules(char, snapshot, client);
    expect(calls.some((c) => c.name === "go" || c.name === "take")).toBe(true);
  });
});

// ── buildSnapshot tests ───────────────────────────────────────────────────────

describe("buildSnapshot", () => {
  it("extracts h3Index from whereami response", () => {
    const s = buildSnapshot(
      { h3Index: "8f2830828052d25" }, {}, { objects: [] }, {}, "self-id"
    );
    expect(s.h3Index).toBe("8f2830828052d25");
  });

  it("falls back to tileId when h3Index absent", () => {
    const s = buildSnapshot({ tileId: "tile-abc" }, {}, { objects: [] }, {}, "self-id");
    expect(s.h3Index).toBe("tile-abc");
  });

  it("excludes self from occupants", () => {
    const s = buildSnapshot(
      { occupants: ["self-id", "other-ghost"] }, {}, { objects: [] }, {}, "self-id"
    );
    expect(s.occupants).toEqual(["other-ghost"]);
    expect(s.occupants).not.toContain("self-id");
  });

  it("parses exits array", () => {
    const s = buildSnapshot(
      {}, { exits: [{ toward: "n" }, { toward: "se" }] }, { objects: [] }, {}, "self-id"
    );
    expect(s.exits).toHaveLength(2);
    expect(s.exits[0]!.toward).toBe("n");
  });

  it("parses inventory objects", () => {
    const s = buildSnapshot(
      {}, {}, { objects: [{ itemRef: "item-1", name: "Badge" }] }, {}, "self-id"
    );
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0]!.name).toBe("Badge");
  });

  it("extracts nearby items from look tiles", () => {
    const s = buildSnapshot(
      {}, {}, { objects: [] },
      { tiles: [{ at: "n", objects: [{ id: "item-1", name: "Token" }] }] },
      "self-id"
    );
    expect(s.nearbyItems).toHaveLength(1);
    expect(s.nearbyItems[0]!.at).toBe("n");
    expect(s.nearbyItems[0]!.name).toBe("Token");
  });
});
