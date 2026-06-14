import { useCallback, useEffect, useRef, useState } from "react";
import type { EvalContract } from "@aie-matrix/shared-types";

const POLL_INTERVAL_MS = 5000;

async function mcpCall<T>(
  worldApiBaseUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  const base = worldApiBaseUrl.endsWith("/")
    ? worldApiBaseUrl.slice(0, -1)
    : worldApiBaseUrl;
  try {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const dataLine = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) return null;
    const envelope = JSON.parse(dataLine.slice("data:".length).trim()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
    };
    const text = envelope.result?.content?.find((c) => c.type === "text")?.text;
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export interface ContractState {
  /** First Open or Submitted contract where the human is the contractor, or null. */
  activeContract: EvalContract | null;
  submitAnswer: (contractId: string, submission: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Polls `eval_contract_list` every 5s for the human's active contract.
 * Exposes `submitAnswer` which calls `eval_contract_submit`.
 */
export function useContracts(
  worldApiBaseUrl: string,
  token: string | null,
  humanGhostId: string,
): ContractState {
  const [activeContract, setActiveContract] = useState<EvalContract | null>(null);

  const fetchActive = useCallback(async () => {
    if (!token || !worldApiBaseUrl || !humanGhostId) return;
    const result = await mcpCall<{ contracts: EvalContract[] }>(
      worldApiBaseUrl,
      token,
      "eval_contract_list",
      {},
    );
    if (!result) return;
    const mine = result.contracts.find(
      (c) =>
        c.contractorId === humanGhostId &&
        (c.state === "Open" || c.state === "Accepted" || c.state === "Submitted"),
    ) ?? null;
    setActiveContract(mine);
  }, [token, worldApiBaseUrl, humanGhostId]);

  useEffect(() => {
    if (!token) return;
    void fetchActive();
    const id = setInterval(() => void fetchActive(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchActive, token]);

  const submitAnswer = useCallback(
    async (contractId: string, submission: string) => {
      if (!token || !worldApiBaseUrl) return;
      // Accept first (contract must be in Accepted state before submitting)
      await mcpCall(worldApiBaseUrl, token, "eval_contract_accept", { contractId });
      await mcpCall(worldApiBaseUrl, token, "eval_contract_submit", {
        contractId,
        submission,
      });
      await fetchActive();
    },
    [token, worldApiBaseUrl, fetchActive],
  );

  const refreshRef = useRef(fetchActive);
  refreshRef.current = fetchActive;

  return {
    activeContract,
    submitAnswer,
    refresh: useCallback(() => refreshRef.current(), []),
  };
}
