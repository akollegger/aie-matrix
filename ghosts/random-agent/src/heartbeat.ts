export type HeartbeatOpts = {
  readonly agentId: string;
  readonly agentHostUrl: string;
  readonly token: string;
  readonly intervalMs?: number;
  readonly onSessionChange: (newSessionId: string) => void;
};

export function startHeartbeat(opts: HeartbeatOpts): () => void {
  const { agentId, agentHostUrl, token, onSessionChange } = opts;
  const intervalMs = opts.intervalMs ?? 30_000;
  let lastSessionId: string | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function beat(): Promise<void> {
    if (stopped) return;
    try {
      const res = await fetch(`${agentHostUrl}/v1/catalog/${agentId}/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ts: new Date().toISOString() }),
      });
      if (res.ok) {
        const body = (await res.json()) as { sessionActive: boolean; sessionId?: string };
        if (body.sessionActive && body.sessionId && body.sessionId !== lastSessionId) {
          lastSessionId = body.sessionId;
          onSessionChange(body.sessionId);
        }
      }
    } catch {
      // silent retry
    }
    if (!stopped) {
      timer = setTimeout(() => { void beat(); }, intervalMs);
    }
  }

  // Fire first beat immediately (via microtask so stop() can be called synchronously before it runs)
  timer = setTimeout(() => { void beat(); }, 0);

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
