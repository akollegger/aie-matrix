export type ReconcileOpts = {
  readonly worldApiUrl: string;
  readonly agentId: string;
  readonly token: string;
  readonly targetCount: number;
  readonly activeLoopsCount: number;
  readonly spawnGhost: () => Promise<{ ghostId: string }>;
};

export type ReconcileResult = {
  readonly spawned: number;
  readonly error?: Error;
};

export async function reconcileRoster(opts: ReconcileOpts): Promise<ReconcileResult> {
  const { worldApiUrl, agentId, token, targetCount, activeLoopsCount, spawnGhost } = opts;

  let existingCount = activeLoopsCount;
  try {
    const res = await fetch(`${worldApiUrl}/registry/ghosts?agentId=${encodeURIComponent(agentId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const ghosts = (await res.json()) as Array<{ ghostId: string }>;
      existingCount = ghosts.length;
    }
  } catch (e) {
    console.warn(JSON.stringify({
      event: "random-agent.reconciliation.error",
      agentId,
      message: e instanceof Error ? e.message : String(e),
      ts: new Date().toISOString(),
    }));
    return { spawned: 0, error: e instanceof Error ? e : new Error(String(e)) };
  }

  const delta = Math.max(0, targetCount - existingCount);

  if (delta === 0) {
    console.log(JSON.stringify({
      event: "random-agent.reconciliation.no-op",
      agentId,
      existingCount,
      targetCount,
      ts: new Date().toISOString(),
    }));
    return { spawned: 0 };
  }

  console.log(JSON.stringify({
    event: "random-agent.reconciliation.spawning",
    agentId,
    existingCount,
    targetCount,
    delta,
    ts: new Date().toISOString(),
  }));

  let spawned = 0;
  let failed = 0;
  for (let i = 0; i < delta; i++) {
    try {
      await spawnGhost();
      spawned++;
    } catch (e) {
      failed++;
      console.warn(JSON.stringify({
        event: "random-agent.reconciliation.spawn-failed",
        agentId,
        attempt: i + 1,
        message: e instanceof Error ? e.message : String(e),
        ts: new Date().toISOString(),
      }));
    }
  }

  return { spawned, ...(failed > 0 ? { error: new Error(`${failed} spawn(s) failed`) } : {}) };
}
