import { createLogger } from "@aie-matrix/logger";

const log = createLogger("npc-agent");

export type HeartbeatOpts = {
  readonly agentId: string;
  readonly agentHostUrl: string;
  readonly token: string;
  readonly intervalMs?: number;
  readonly onNotRegistered?: () => void;
};

export function startHeartbeat(opts: HeartbeatOpts): () => void {
  const { agentId, agentHostUrl, token } = opts;
  const intervalMs = opts.intervalMs ?? 30_000;
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
      if (res.status === 404) {
        // Agent-host was restarted and lost this agent's registration.
        log.warn({ kind: "npc-agent.heartbeat.not-registered", agentId });
        opts.onNotRegistered?.();
        return; // stop loop — caller restarts it after re-registration
      }
    } catch {
      // network error — silent retry at next interval
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
