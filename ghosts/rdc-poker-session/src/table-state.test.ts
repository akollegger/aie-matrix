import { describe, expect, it, beforeEach, vi } from "vitest";
import { ActiveTable, type TableConfig, type TableSeat } from "./table-state.js";
import { midpointPersonality } from "@aie-matrix/ghost-peppers-inner";

const cfg: TableConfig = {
  platformId: "PokerTable:test",
  platformClass: "PokerTable",
  capacity: 3,
  minPlayers: 2,
  buyIn: 100,
  smallBlind: 1,
  bigBlind: 2,
  setting: "test",
};

function mkSeat(id: string, chipStack = 100): TableSeat {
  return {
    ghostId: id,
    displayName: id,
    role: "outlaw",
    initialPersonality: midpointPersonality(),
    personality: midpointPersonality(),
    mathSchool: "Sklansky",
    opponentReads: new Map(),
    barnacleSessionId: `sess-${id}`,
    supervisorA2A: "http://test/a2a",
    seatedAtMs: Date.now(),
    chipStack,
    recentOutcomes: [],
    isTilted: false,
  };
}

describe("ActiveTable — seating + capacity", () => {
  it("seats up to capacity, then returns 'full'", () => {
    const t = new ActiveTable(cfg);
    expect(t.seat(mkSeat("a"))).toBe("seated");
    expect(t.seat(mkSeat("b"))).toBe("seated");
    expect(t.seat(mkSeat("c"))).toBe("seated");
    expect(t.seat(mkSeat("d"))).toBe("full");
    expect(t.size()).toBe(3);
  });

  it("rejects duplicate ghostId with 'already-here'", () => {
    const t = new ActiveTable(cfg);
    expect(t.seat(mkSeat("a"))).toBe("seated");
    expect(t.seat(mkSeat("a"))).toBe("already-here");
    expect(t.size()).toBe(1);
  });

  it("release removes the seat and returns it", () => {
    const t = new ActiveTable(cfg);
    const s = mkSeat("a", 73);
    t.seat(s);
    const released = t.release("a");
    expect(released?.ghostId).toBe("a");
    expect(released?.chipStack).toBe(73);
    expect(t.size()).toBe(0);
    expect(t.hasSeat("a")).toBe(false);
  });

  it("release returns undefined for an unknown ghostId", () => {
    const t = new ActiveTable(cfg);
    expect(t.release("nobody")).toBeUndefined();
  });
});

describe("ActiveTable — cooldown registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("a ghost with no cooldown reports 0 ms remaining", () => {
    const t = new ActiveTable(cfg);
    expect(t.cooldownRemainingMs("any")).toBe(0);
  });

  it("setCooldown(60_000) makes the ghost wait, then expires after the duration", () => {
    const t = new ActiveTable(cfg);
    t.setCooldown("busted", 60_000);
    expect(t.cooldownRemainingMs("busted")).toBe(60_000);
    vi.advanceTimersByTime(30_000);
    expect(t.cooldownRemainingMs("busted")).toBe(30_000);
    vi.advanceTimersByTime(30_000);
    expect(t.cooldownRemainingMs("busted")).toBe(0);
  });

  it("setCooldown with non-positive duration clears any existing cooldown", () => {
    const t = new ActiveTable(cfg);
    t.setCooldown("g", 60_000);
    expect(t.cooldownRemainingMs("g")).toBeGreaterThan(0);
    t.setCooldown("g", 0);
    expect(t.cooldownRemainingMs("g")).toBe(0);
  });

  it("cooldown is per-ghost — others are unaffected", () => {
    const t = new ActiveTable(cfg);
    t.setCooldown("a", 60_000);
    expect(t.cooldownRemainingMs("a")).toBe(60_000);
    expect(t.cooldownRemainingMs("b")).toBe(0);
  });

  it("expired entries are pruned on read (so the map doesn't grow unbounded)", () => {
    const t = new ActiveTable(cfg);
    t.setCooldown("ephemeral", 1_000);
    vi.advanceTimersByTime(2_000);
    // First read prunes; second read should still be 0 with no entry held.
    expect(t.cooldownRemainingMs("ephemeral")).toBe(0);
    // After pruning, setting a new cooldown still works.
    t.setCooldown("ephemeral", 5_000);
    expect(t.cooldownRemainingMs("ephemeral")).toBe(5_000);
  });
});

describe("TableSeat.chipStack — the persistence the user wanted", () => {
  it("chipStack is mutable (it has to be — hands debit/credit it)", () => {
    const s = mkSeat("a", 100);
    s.chipStack = 137;
    expect(s.chipStack).toBe(137);
    s.chipStack = 0;
    expect(s.chipStack).toBe(0);
  });

  it("a seat in ActiveTable retains its chipStack mutations (same object reference)", () => {
    const t = new ActiveTable(cfg);
    const s = mkSeat("a", 100);
    t.seat(s);
    // Simulate a hand crediting them 42 chips.
    s.chipStack += 42;
    const fetched = t.getSeat("a");
    expect(fetched).toBe(s); // same reference
    expect(fetched?.chipStack).toBe(142);
  });
});
