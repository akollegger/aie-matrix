import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { GhostMcpService, type GhostMcpServiceShape } from "../src/mcp-effect.js";
import {
  brokerTick,
  brokerHandleAccept,
  handleContractSubmitted,
  clearBrokerState,
  getBrokerGhostIdForContract,
} from "../src/behavior/broker-behavior.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

type Call = { name: string; args: Record<string, unknown> };

type McpOverrides = Partial<{
  inboxNotifications: Array<{ thread_id: string; message_id: string }>;
  evalContractOpenResult: unknown;
  holdings: Array<{ resource: string; qty: number; label: string }>;
}>;

function makeMcpLayer(overrides: McpOverrides = {}): { layer: Layer.Layer<GhostMcpService>; calls: Call[] } {
  const calls: Call[] = [];

  function track(name: string, args: Record<string, unknown> = {}, result: unknown = { ok: true }) {
    calls.push({ name, args });
    return Effect.succeed(result);
  }

  const service: GhostMcpServiceShape = {
    whereami:             Effect.succeed({ h3Index: "", tileId: "", col: 0, row: 0 }),
    exits:                Effect.succeed({ exits: [] }),
    look:                 () => Effect.succeed({ tiles: [] }),
    go:                   (args) => track("go", args as Record<string, unknown>, { ok: true, tileId: "" }),
    take:                 (args) => track("take", args as Record<string, unknown>, { ok: true, name: "" }),
    traverse:             (args) => track("traverse", args as Record<string, unknown>, { ok: true, via: "", from: "", to: "", tileClass: "" }),
    inventory:            Effect.succeed({ ok: true as const, objects: [], holdings: overrides.holdings ?? [{ resource: "broker-credits", qty: 50, label: "Broker Credits" }] }),
    say:                  (args) => track("say", args as Record<string, unknown>, { message_id: "m1", mx_listeners: [] }),
    inbox:                Effect.sync(() => {
      calls.push({ name: "inbox", args: {} });
      return { notifications: overrides.inboxNotifications ?? [] };
    }),
    evalContractOpen:     (args) => track("evalContractOpen", args as Record<string, unknown>,
                            overrides.evalContractOpenResult ?? { contractId: "contract-001" }),
    evalContractEvaluate: (args) => track("evalContractEvaluate", args as Record<string, unknown>, { ok: true }),
  };

  return { layer: Layer.succeed(GhostMcpService, service), calls };
}

function run<A>(effect: Effect.Effect<A, unknown, GhostMcpService>, layer: Layer.Layer<GhostMcpService>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

// ── clearBrokerState ──────────────────────────────────────────────────────────

describe("clearBrokerState", () => {
  it("removes all state for the given ghostId", async () => {
    const ghostId = "ghost-clear-test";
    clearBrokerState(ghostId);

    const { layer } = makeMcpLayer({
      inboxNotifications: [{ thread_id: "other-ghost", message_id: "m1" }],
      evalContractOpenResult: { contractId: "contract-clear-test" },
    });

    // Open a contract via brokerHandleAccept (inbox just advertises, accept triggers the open)
    await run(brokerHandleAccept(ghostId, "other-ghost", 1), layer);

    // Verify contract was registered
    expect(getBrokerGhostIdForContract("contract-clear-test")).toBe(ghostId);

    // Clear it
    clearBrokerState(ghostId);

    expect(getBrokerGhostIdForContract("contract-clear-test")).toBeUndefined();

    // handleContractSubmitted for the old contract should be a no-op
    const { layer: layer2, calls: calls2 } = makeMcpLayer();
    await run(handleContractSubmitted("contract-clear-test", "other-ghost"), layer2);
    expect(calls2.filter((c) => c.name === "evalContractEvaluate")).toHaveLength(0);
  });
});

// ── brokerTick ────────────────────────────────────────────────────────────────

describe("brokerTick", () => {
  beforeEach(() => {
    clearBrokerState("ghost-broker-1");
    clearBrokerState("ghost-broker-2");
  });

  it("returns immediately when inbox is empty", async () => {
    const { layer, calls } = makeMcpLayer({ inboxNotifications: [] });
    await run(brokerTick("ghost-broker-1"), layer);
    expect(calls.filter((c) => c.name === "say")).toHaveLength(0);
  });

  it("sends advertisement in response to any inbox notification when idle", async () => {
    const { layer, calls } = makeMcpLayer({
      inboxNotifications: [{ thread_id: "ghost-abc", message_id: "m1" }],
    });
    await run(brokerTick("ghost-broker-1"), layer);
    const sayCall = calls.find((c) => c.name === "say");
    expect(sayCall).toBeDefined();
    expect((sayCall!.args as { intent: string }).intent).toBe("propose");
    expect((sayCall!.args as { to: string }).to).toBe("ghost-abc");
  });
});

// ── brokerHandleAccept ────────────────────────────────────────────────────────

describe("brokerHandleAccept", () => {
  beforeEach(() => {
    clearBrokerState("ghost-broker-1");
  });

  it("opens a contract and registers it", async () => {
    const { layer, calls } = makeMcpLayer({
      evalContractOpenResult: { contractId: "contract-test-001" },
    });
    await run(brokerHandleAccept("ghost-broker-1", "ghost-abc", 1), layer);
    expect(calls.some((c) => c.name === "evalContractOpen")).toBe(true);
    expect(getBrokerGhostIdForContract("contract-test-001")).toBe("ghost-broker-1");
  });

  it("declines when eval_contract_open returns insufficient funds", async () => {
    const { layer, calls } = makeMcpLayer({
      evalContractOpenResult: { code: "LedgerError.InsufficientFunds" },
    });
    await run(brokerHandleAccept("ghost-broker-1", "ghost-abc", 1), layer);
    const declineCall = calls.find(
      (c) => c.name === "say" && (c.args as { intent: string }).intent === "decline",
    );
    expect(declineCall).toBeDefined();
  });

  it("declines without calling evalContractOpen when inventory is empty", async () => {
    const { layer, calls } = makeMcpLayer({ holdings: [] });
    await run(brokerHandleAccept("ghost-broker-1", "ghost-abc", 1), layer);
    expect(calls.some((c) => c.name === "evalContractOpen")).toBe(false);
    const declineCall = calls.find(
      (c) => c.name === "say" && (c.args as { intent: string }).intent === "decline",
    );
    expect(declineCall).toBeDefined();
  });

  it("uses stakeAmount from character definition when opening a contract", async () => {
    const { layer, calls } = makeMcpLayer({
      holdings: [{ resource: "broker-credits", qty: 10, label: "Broker Credits" }],
      evalContractOpenResult: { contractId: "contract-stake-3" },
    });
    await run(brokerHandleAccept("ghost-broker-1", "ghost-abc", 3), layer);
    const openCall = calls.find((c) => c.name === "evalContractOpen");
    expect(openCall).toBeDefined();
    expect((openCall!.args as { stakeAmount: number }).stakeAmount).toBe(3);
    expect((openCall!.args as { stakeResource: string }).stakeResource).toBe("broker-credits");
  });
});

// ── handleContractSubmitted ───────────────────────────────────────────────────

describe("handleContractSubmitted", () => {
  beforeEach(() => {
    clearBrokerState("ghost-broker-eval");
  });

  it("evaluates contract and resets state to idle", async () => {
    const ghostId = "ghost-broker-eval";
    const { layer, calls } = makeMcpLayer({
      evalContractOpenResult: { contractId: "contract-eval-001" },
    });

    // Open a contract first
    await run(brokerHandleAccept(ghostId, "contractor-ghost", 1), layer);

    // Evaluate it
    await run(handleContractSubmitted("contract-eval-001", "contractor-ghost"), layer);

    const evaluateCall = calls.find((c) => c.name === "evalContractEvaluate");
    expect(evaluateCall).toBeDefined();
    expect((evaluateCall!.args as { verdict: number }).verdict).toBe(1.0);

    // Contract should be gone
    expect(getBrokerGhostIdForContract("contract-eval-001")).toBeUndefined();
  });

  it("is a no-op for an unknown contractId", async () => {
    const { layer, calls } = makeMcpLayer();
    await run(handleContractSubmitted("unknown-contract-id", "some-ghost"), layer);
    expect(calls.filter((c) => c.name === "evalContractEvaluate")).toHaveLength(0);
  });
});
