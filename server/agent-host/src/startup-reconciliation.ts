import { createLogger } from "@aie-matrix/logger";
import type { CatalogFile } from "./catalog/CatalogService.js";

const log = createLogger("agent-host");

/** Minimal catalog interface needed for reconciliation (Promise-based for testability). */
export type ReconciliationCatalog = {
  load: () => Promise<CatalogFile>;
  save: (file: CatalogFile) => Promise<void>;
};

/** Minimal supervisor interface needed for reconciliation. */
export type ReconciliationSupervisor = {
  spawnRosterForAgent: (
    agentId: string,
    baseUrl: string,
  ) => Promise<{ spawned: unknown[]; failed: unknown[] }>;
};

export type ReconciliationOpts = {
  readonly worldApiUrl: string;
  readonly catalog: ReconciliationCatalog;
  readonly supervisor: ReconciliationSupervisor;
};

export type ReconciliationResult = {
  readonly spawned: number;
  readonly inactive: number;
  readonly total: number;
  readonly skipped?: "no-active-session" | "no-roster-agents" | "live-check-failed";
};

export async function runStartupReconciliation(
  opts: ReconciliationOpts,
): Promise<ReconciliationResult> {
  const { worldApiUrl, catalog, supervisor } = opts;

  // 1. Check for an active world session
  let liveRes: Response;
  try {
    liveRes = await fetch(`${worldApiUrl}/live?status=active`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    log.info({ kind: "agent-host.startup-reconciliation.live-check-failed" });
    return { spawned: 0, inactive: 0, total: 0, skipped: "live-check-failed" };
  }

  if (!liveRes.ok) {
    log.info({ kind: "agent-host.startup-reconciliation.live-check-failed" });
    return { spawned: 0, inactive: 0, total: 0, skipped: "live-check-failed" };
  }

  const sessions = (await liveRes.json()) as Array<{ id: string }>;
  const sessionActive = Array.isArray(sessions) && sessions.length > 0;
  if (!sessionActive) {
    log.info({ kind: "agent-host.startup-reconciliation.no-active-session" });
    return { spawned: 0, inactive: 0, total: 0, skipped: "no-active-session" };
  }

  log.info({
    kind: "agent-host.startup-reconciliation.found-session",
    sessionId: sessions[0]!.id,
  });

  // 2. Load catalog and find roster agents
  const catalogFile = await catalog.load();
  const rosterEntries = Object.entries(catalogFile.agents).filter(([, entry]) => {
    if (entry.kind === "mini-game") return false;
    return (entry.agentCard as { matrix?: { rosterAgent?: boolean } }).matrix?.rosterAgent === true;
  });

  if (rosterEntries.length === 0) {
    log.info({ kind: "agent-host.startup-reconciliation.no-roster-agents-in-catalog" });
    return { spawned: 0, inactive: 0, total: 0, skipped: "no-roster-agents" };
  }

  // 3. Eagerly ping each rosterAgent; spawn only if reachable
  let spawned = 0;
  let inactive = 0;
  for (const [agentId, entry] of rosterEntries) {
    try {
      const pingRes = await fetch(`${entry.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!pingRes.ok) throw new Error(`HTTP ${pingRes.status}`);
      log.info({ kind: "agent-host.startup-reconciliation.ping-ok", agentId });
    } catch (pingErr) {
      const updatedEntry = { ...entry, healthStatus: "inactive" as const };
      await catalog.save({ agents: { ...catalogFile.agents, [agentId]: updatedEntry } });
      log.info({
        kind: "agent-host.startup-reconciliation.ping-fail",
        agentId,
        reason: pingErr instanceof Error ? pingErr.message : String(pingErr),
      });
      inactive++;
      continue;
    }

    const result = await supervisor.spawnRosterForAgent(agentId, entry.baseUrl);
    log.info({
      kind: "agent-host.startup-reconciliation.roster-spawn-complete",
      agentId,
      spawned: result.spawned.length,
      failed: result.failed.length,
    });
    spawned += result.spawned.length;
  }

  log.info({
    kind: "agent-host.startup-reconciliation.complete",
    spawned,
    inactive,
    total: rosterEntries.length,
  });

  return { spawned, inactive, total: rosterEntries.length };
}
