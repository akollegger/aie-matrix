import { useCallback, useEffect, useState } from "react";
import type { InventoryResult } from "@aie-matrix/shared-types";

const BROKER_CREDIT_REF = "brokerCredit";

interface BalanceDisplayProps {
  token: string | null;
  worldApiBaseUrl: string;
  refreshTrigger?: number;
}

async function fetchBalance(
  worldApiBaseUrl: string,
  token: string,
): Promise<number | null> {
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
        params: { name: "inventory", arguments: {} },
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
    if (!text) return null;
    const inv = JSON.parse(text) as InventoryResult;
    const holding = inv.holdings?.find((h) => h.resource === BROKER_CREDIT_REF);
    return holding?.qty ?? 0;
  } catch {
    return null;
  }
}

/**
 * Displays the human's broker-credit balance from the ledger.
 * Calls the MCP `inventory` tool using the guest JWT.
 * Re-fetches when `refreshTrigger` changes.
 */
export function BalanceDisplay({ token, worldApiBaseUrl, refreshTrigger = 0 }: BalanceDisplayProps) {
  const [balance, setBalance] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !worldApiBaseUrl) return;
    const qty = await fetchBalance(worldApiBaseUrl, token);
    if (qty !== null) setBalance(qty);
  }, [token, worldApiBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTrigger]);

  if (balance === null) return null;

  return (
    <div
      title="Broker credits"
      style={{
        fontFamily: "system-ui, monospace",
        fontSize: 12,
        color: "rgba(200, 230, 200, 0.85)",
        padding: "2px 8px",
        background: "rgba(0,0,0,0.45)",
        borderRadius: 4,
        border: "1px solid rgba(100,200,100,0.3)",
        userSelect: "none",
      }}
    >
      ◈ {balance}
    </div>
  );
}
