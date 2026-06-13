import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { funderTick, handleContractSubmitted, clearFunderState } from "../src/behavior/funder-behavior.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMcp(overrides: Partial<{ callTool: GhostMcpClient["callTool"] }> = {}): {
  client: GhostMcpClient;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === "eval_contract_open") return { contractId: "contract-001" };
      return {};
    }),
    ...overrides,
  } as unknown as GhostMcpClient;
  return { client, calls };
}

// ── clearFunderState ──────────────────────────────────────────────────────────

describe("clearFunderState", () => {
  it("removes all state for the given ghostId", async () => {
    const ghostId = "ghost-clear-test";
    const { client } = makeMcp();

    // Simulate a contract being opened by running a tick with "accept"
    const mcp = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        if (name === "inbox") {
          return { notifications: [{ from: "other-ghost", text: "accept" }] };
        }
        if (name === "eval_contract_open") return { contractId: "contract-clear-test" };
        return {};
      }),
    } as unknown as GhostMcpClient;

    await funderTick(ghostId, mcp);

    // State should now be awaiting_submission — clear it
    clearFunderState(ghostId);

    // After clearing, handleContractSubmitted for the old contract should be a no-op
    const mcpByGhostId = new Map<string, GhostMcpClient>([[ghostId, client]]);
    await handleContractSubmitted("contract-clear-test", "other-ghost", mcpByGhostId);

    // eval_contract_evaluate must NOT have been called
    const evaluateCalls = (client.callTool as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([name]: [string]) => name === "eval_contract_evaluate",
    );
    expect(evaluateCalls).toHaveLength(0);
  });
});

// ── funderTick ────────────────────────────────────────────────────────────────

describe("funderTick", () => {
  beforeEach(() => {
    // Reset state between tests
    clearFunderState("ghost-funder-1");
    clearFunderState("ghost-funder-2");
  });

  it("returns immediately when inbox is empty", async () => {
    const { client, calls } = makeMcp();
    const mcp = {
      callTool: vi.fn(async (name: string) => {
        calls.push({ name, args: {} });
        if (name === "inbox") return { notifications: [] };
        return {};
      }),
    } as unknown as GhostMcpClient;

    await funderTick("ghost-funder-1", mcp);

    const sayCall = calls.find((c) => c.name === "say");
    expect(sayCall).toBeUndefined();
  });

  it("sends advertisement in response to any message when idle", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const mcp = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === "inbox") {
          return { notifications: [{ from: "ghost-abc", text: "hello there" }] };
        }
        return {};
      }),
    } as unknown as GhostMcpClient;

    await funderTick("ghost-funder-1", mcp);

    const sayCall = calls.find((c) => c.name === "say");
    expect(sayCall).toBeDefined();
    expect((sayCall!.args as { intent: string }).intent).toBe("propose");
    expect((sayCall!.args as { to: string }).to).toBe("ghost-abc");
  });

  it("opens a contract when inbox contains 'accept'", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const mcp = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === "inbox") {
          return { notifications: [{ from: "ghost-abc", text: "accept" }] };
        }
        if (name === "eval_contract_open") return { contractId: "contract-test-001" };
        return {};
      }),
    } as unknown as GhostMcpClient;

    await funderTick("ghost-funder-1", mcp);

    const contractCall = calls.find((c) => c.name === "eval_contract_open");
    expect(contractCall).toBeDefined();
    expect((contractCall!.args as { contractorId: string }).contractorId).toBe("ghost-abc");
  });

  it("declines when eval_contract_open returns insufficient funds", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const mcp = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === "inbox") {
          return { notifications: [{ from: "ghost-abc", text: "accept" }] };
        }
        if (name === "eval_contract_open") return { code: "LedgerError.InsufficientFunds" };
        return {};
      }),
    } as unknown as GhostMcpClient;

    await funderTick("ghost-funder-1", mcp);

    const declineCall = calls.find(
      (c) => c.name === "say" && (c.args as { intent: string }).intent === "decline",
    );
    expect(declineCall).toBeDefined();
  });
});

// ── handleContractSubmitted ───────────────────────────────────────────────────

describe("handleContractSubmitted", () => {
  beforeEach(() => {
    clearFunderState("ghost-funder-eval");
  });

  it("evaluates contract and resets state to idle", async () => {
    const ghostId = "ghost-funder-eval";
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const mcp = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === "inbox") {
          return { notifications: [{ from: "contractor-ghost", text: "accept" }] };
        }
        if (name === "eval_contract_open") return { contractId: "contract-eval-001" };
        return {};
      }),
    } as unknown as GhostMcpClient;

    // Open a contract first
    await funderTick(ghostId, mcp);

    // Now evaluate it
    const mcpByGhostId = new Map<string, GhostMcpClient>([[ghostId, mcp]]);
    await handleContractSubmitted("contract-eval-001", "contractor-ghost", mcpByGhostId);

    const evaluateCall = calls.find((c) => c.name === "eval_contract_evaluate");
    expect(evaluateCall).toBeDefined();
    expect((evaluateCall!.args as { verdict: number }).verdict).toBe(1.0);

    // State should be reset — a second tick with "accept" should open a new contract
    calls.length = 0;
    const mcp2 = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        calls.push({ name, args });
        if (name === "inbox") {
          return { notifications: [{ from: "new-contractor", text: "accept" }] };
        }
        if (name === "eval_contract_open") return { contractId: "contract-eval-002" };
        return {};
      }),
    } as unknown as GhostMcpClient;

    await funderTick(ghostId, mcp2);
    const newContractCall = calls.find((c) => c.name === "eval_contract_open");
    expect(newContractCall).toBeDefined();
  });

  it("is a no-op for an unknown contractId", async () => {
    const ghostId = "ghost-funder-eval";
    const { client } = makeMcp();
    const mcpByGhostId = new Map<string, GhostMcpClient>([[ghostId, client]]);

    await handleContractSubmitted("unknown-contract-id", "some-ghost", mcpByGhostId);

    const evaluateCalls = (client.callTool as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([name]: [string]) => name === "eval_contract_evaluate",
    );
    expect(evaluateCalls).toHaveLength(0);
  });
});
