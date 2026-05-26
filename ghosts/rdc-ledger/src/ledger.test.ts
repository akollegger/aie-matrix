import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { Ledger } from "./ledger.js";

describe("Ledger — credits", () => {
  test("getBalance creates a starting balance for new ghosts", () => {
    const l = new Ledger({ startingBalance: 100 });
    expect(l.getBalance("ghost-a")).toBe(100);
  });

  test("award and debit move balance correctly", () => {
    const l = new Ledger({ startingBalance: 100 });
    expect(l.award("ghost-a", 50, "found gold").ok).toBe(true);
    expect(l.getBalance("ghost-a")).toBe(150);
    expect(l.debit("ghost-a", 20, "drink").ok).toBe(true);
    expect(l.getBalance("ghost-a")).toBe(130);
  });

  test("debit fails when balance < amount", () => {
    const l = new Ledger({ startingBalance: 10 });
    const r = l.debit("ghost-a", 50, "too rich");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INSUFFICIENT_FUNDS");
      expect(l.getBalance("ghost-a")).toBe(10);
    }
  });

  test("transfer is atomic", () => {
    const l = new Ledger({ startingBalance: 100 });
    const r = l.transfer("ghost-a", "ghost-b", 30, "owed");
    expect(r.ok).toBe(true);
    expect(l.getBalance("ghost-a")).toBe(70);
    expect(l.getBalance("ghost-b")).toBe(130);
  });

  test("transfer fails on insufficient funds and leaves both balances unchanged", () => {
    const l = new Ledger({ startingBalance: 50 });
    const r = l.transfer("ghost-a", "ghost-b", 200, "impossible");
    expect(r.ok).toBe(false);
    expect(l.getBalance("ghost-a")).toBe(50);
    expect(l.getBalance("ghost-b")).toBe(50);
  });
});

describe("Ledger — bounties", () => {
  test("placeBounty escrows credits and creates an open bounty", () => {
    const l = new Ledger({ startingBalance: 200 });
    const r = l.placeBounty("placer", "target", 50, "double-cross");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("open");
      expect(r.value.amount).toBe(50);
    }
    expect(l.getBalance("placer")).toBe(150);
    expect(l.listOpenBounties("target")).toHaveLength(1);
  });

  test("claimBounty pays the claimer and marks the bounty claimed", () => {
    const l = new Ledger({ startingBalance: 200 });
    const placed = l.placeBounty("placer", "target", 50, "double-cross");
    if (!placed.ok) throw new Error("place failed");
    const claim = l.claimBounty(placed.value.id, "hunter");
    expect(claim.ok).toBe(true);
    expect(l.getBalance("hunter")).toBe(250);
    expect(l.listOpenBounties()).toHaveLength(0);
  });

  test("target cannot self-claim", () => {
    const l = new Ledger({ startingBalance: 200 });
    const placed = l.placeBounty("placer", "target", 50, "double-cross");
    if (!placed.ok) throw new Error("place failed");
    const claim = l.claimBounty(placed.value.id, "target");
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.error.code).toBe("BOUNTY_SELF_CLAIM");
  });

  test("revokeBounty refunds the placer", () => {
    const l = new Ledger({ startingBalance: 200 });
    const placed = l.placeBounty("placer", "target", 50, "double-cross");
    if (!placed.ok) throw new Error("place failed");
    const r = l.revokeBounty(placed.value.id);
    expect(r.ok).toBe(true);
    expect(l.getBalance("placer")).toBe(200);
  });
});

describe("Ledger — file persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rdc-ledger-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("snapshot survives a round-trip through disk", async () => {
    const path = join(dir, "ledger.json");
    const l1 = new Ledger({ persistPath: path, startingBalance: 100 });
    l1.award("ghost-a", 50, "test");
    l1.placeBounty("ghost-a", "target", 30, "test");
    // Wait for any queued writes to flush.
    await new Promise((r) => setTimeout(r, 50));

    const l2 = new Ledger({ persistPath: path, startingBalance: 100 });
    await l2.load();
    expect(l2.getBalance("ghost-a")).toBe(120); // 100 + 50 - 30 escrowed
    expect(l2.listOpenBounties("target")).toHaveLength(1);
  });
});

describe("Ledger — skill profiles (RFC-0018)", () => {
  test("getSkillProfile lazily initialises new ghosts as Greenhorn / 0", () => {
    const l = new Ledger();
    const p = l.getSkillProfile("ghost-a");
    expect(p.tier).toBe("Greenhorn");
    expect(p.handsPlayed).toBe(0);
    expect(p.school).toBeUndefined();
  });

  test("recordHandPlayed promotes Greenhorn → Journeyman at 10 hands", () => {
    const l = new Ledger();
    for (let i = 0; i < 9; i++) l.recordHandPlayed("g");
    expect(l.getSkillProfile("g").tier).toBe("Greenhorn");
    const r = l.recordHandPlayed("g");
    expect(r.promoted).toBe(true);
    expect(r.profile.tier).toBe("Journeyman");
    expect(r.profile.handsPlayed).toBe(10);
  });

  test("recordHandPlayed promotes through Veteran (50) and Eagle (200)", () => {
    const l = new Ledger();
    for (let i = 0; i < 50; i++) l.recordHandPlayed("g");
    expect(l.getSkillProfile("g").tier).toBe("Veteran");
    for (let i = 0; i < 150; i++) l.recordHandPlayed("g");
    expect(l.getSkillProfile("g").tier).toBe("Eagle");
    expect(l.getSkillProfile("g").handsPlayed).toBe(200);
  });

  test("setSkillSchool is sticky — first write wins", () => {
    const l = new Ledger();
    l.setSkillSchool("g", "Hellmuth");
    l.setSkillSchool("g", "GTO");
    expect(l.getSkillProfile("g").school).toBe("Hellmuth");
  });

  test("transferSkill (max) lifts recipient on every dimension", () => {
    const l = new Ledger();
    for (let i = 0; i < 100; i++) l.recordHandPlayed("victim");
    l.setSkillSchool("victim", "Hellmuth");
    for (let i = 0; i < 5; i++) l.recordHandPlayed("hunter");
    const after = l.transferSkill("victim", "hunter");
    expect(after.tier).toBe("Veteran");
    expect(after.handsPlayed).toBe(100);
    // Hunter has no school yet → inherits victim's.
    expect(after.school).toBe("Hellmuth");
  });

  test("transferSkill (max) never reduces an already-higher recipient", () => {
    const l = new Ledger();
    for (let i = 0; i < 200; i++) l.recordHandPlayed("hunter");
    l.setSkillSchool("hunter", "GTO");
    for (let i = 0; i < 5; i++) l.recordHandPlayed("victim");
    l.setSkillSchool("victim", "Hellmuth");
    const after = l.transferSkill("victim", "hunter");
    expect(after.tier).toBe("Eagle");
    expect(after.handsPlayed).toBe(200);
    // Hunter already had a school → not overwritten.
    expect(after.school).toBe("GTO");
  });
});
