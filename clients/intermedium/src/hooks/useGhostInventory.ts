import { useEffect, useState } from "react";

export interface InventoryItem {
  readonly itemRef: string;
  readonly name: string;
}

interface GhostInventoryState {
  readonly items: readonly InventoryItem[];
  readonly isLoading: boolean;
}

const POLL_INTERVAL_MS = 5000;

export function useGhostInventory(ghostId: string | null, worldApiUrl: string): GhostInventoryState {
  const [items, setItems] = useState<readonly InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!ghostId || !worldApiUrl) {
      setItems([]);
      return;
    }

    let cancelled = false;
    const base = worldApiUrl.endsWith("/") ? worldApiUrl : `${worldApiUrl}/`;

    const poll = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          new URL(`ghosts/${encodeURIComponent(ghostId)}/inventory`, base).toString(),
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { items?: InventoryItem[] };
        if (!cancelled) setItems(data.items ?? []);
      } catch {
        // silently fail — world server may not be running
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ghostId, worldApiUrl]);

  return { items, isLoading };
}
