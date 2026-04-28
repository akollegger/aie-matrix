import { useEffect, useState } from "react";

export interface AgentCardDetail {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly tier: string;
  readonly ghostClasses: readonly string[];
  readonly requiredTools: readonly string[];
  readonly memoryKind: string;
  readonly llmProvider: string;
  readonly authors: readonly string[];
}

export function useAgentCard(
  agentId: string | null,
  ghostHouseUrl: string,
): AgentCardDetail | null {
  const [card, setCard] = useState<AgentCardDetail | null>(null);

  useEffect(() => {
    if (!agentId || !ghostHouseUrl) { setCard(null); return; }
    const base = ghostHouseUrl.endsWith("/") ? ghostHouseUrl : `${ghostHouseUrl}/`;
    let cancelled = false;

    fetch(new URL(`v1/catalog/${encodeURIComponent(agentId)}`, base).toString(), {
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: unknown) => {
        if (cancelled || !raw || typeof raw !== "object") return;
        const r = raw as Record<string, unknown>;
        const matrix = (r.matrix ?? {}) as Record<string, unknown>;
        const profile = (matrix.profile ?? {}) as Record<string, unknown>;
        setCard({
          name: typeof r.name === "string" ? r.name : agentId,
          description: typeof r.description === "string" ? r.description : "",
          version: typeof r.version === "string" ? r.version : "",
          tier: typeof matrix.tier === "string" ? matrix.tier : "",
          ghostClasses: Array.isArray(matrix.ghostClasses)
            ? (matrix.ghostClasses as string[])
            : [],
          requiredTools: Array.isArray(matrix.requiredTools)
            ? (matrix.requiredTools as string[])
            : [],
          memoryKind: typeof matrix.memoryKind === "string" ? matrix.memoryKind : "",
          llmProvider: typeof matrix.llmProvider === "string" ? matrix.llmProvider : "",
          authors: Array.isArray(matrix.authors) ? (matrix.authors as string[]) : [],
        });
        // suppress unused warning — profile.about is shown via ghostIdentity.name
        void profile;
      })
      .catch(() => { if (!cancelled) setCard(null); });

    return () => { cancelled = true; };
  }, [agentId, ghostHouseUrl]);

  return card;
}
