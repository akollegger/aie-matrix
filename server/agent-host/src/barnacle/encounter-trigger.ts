/**
 * RFC-0019 — encounter trigger.
 *
 * Subscribes to the matrix Colyseus room, watches for ghost arrivals
 * on tiles adjacent to `Platform:*` world items, and drives the
 * encounter handshake with peppers:
 *
 *   adjacency detected
 *      → send `platform.encounter.v1` to peppers
 *      → peppers's brain replies accept/decline
 *      → on accept: hand off to the Barnacle supervisor's beginSession
 *
 * `beginSession` then does the withdraw → pause → handoff sequence.
 *
 * Dormant by default. Enable with env `AIE_MATRIX_BARNACLE_ENCOUNTERS=1`
 * so it doesn't race with the legacy rdc-orchestrator path during the
 * phase 5 migration. Phase 5b.2 retires the legacy path and flips the
 * default on.
 *
 * The list of platform-classes we react to is hardcoded for v1
 * (matches the catalog kinds registered). Future: drive it from the
 * catalog's `platformClasses` aggregate so new mini-games auto-route.
 */
import { Client } from "colyseus.js";
import { gridDisk } from "h3-js";

import {
  BARNACLE_HEARTBEAT_SCHEMA, // re-exported pun: silence unused warning
  PLATFORM_ENCOUNTER_SCHEMA,
  type BarnaclePersonalitySnapshot,
  type PlatformEncounter,
  type PlatformEncounterReply,
} from "@aie-matrix/shared-types";

import type { ICatalogService } from "../catalog/CatalogService.js";
import type { IAgentSupervisor } from "../supervisor/SupervisorService.js";
import { Effect } from "effect";
import { getBarnacleA2AClient, sendDataAndAwaitReply } from "./a2a-client.js";
import type { IBarnacleSupervisor } from "./BarnacleSupervisorService.js";

// Silence unused — kept in the import surface so the re-export reads
// as one consolidated list of Barnacle protocol references.
void BARNACLE_HEARTBEAT_SCHEMA;

export interface EncounterTriggerOptions {
  /** Where the matrix Colyseus room lives (e.g. http://127.0.0.1:8787). */
  readonly worldHttpBase: string;
  /** Where the registry lives (for GET /registry/ghosts/:id). Usually
   *  the same as worldHttpBase. */
  readonly registryBaseUrl: string;
  /** Shared dev bearer token (for A2A calls). */
  readonly devToken: string;
  readonly catalog: ICatalogService;
  readonly agentSupervisor: IAgentSupervisor;
  readonly barnacleSupervisor: IBarnacleSupervisor;
}

export interface EncounterTriggerHandle {
  readonly close: () => Promise<void>;
}

interface RegistryGhostRecord {
  readonly id: string;
  readonly h3Index: string;
  readonly spawnH3Index: string;
  readonly status: string;
}

function parseItemRefs(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function httpBaseToWsBase(httpBase: string): string {
  const u = new URL(httpBase);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.origin;
}

async function resolveMatrixRoomId(worldHttpBase: string): Promise<string> {
  const url = `${worldHttpBase.replace(/\/$/, "")}/spectator/room`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`spectator/room: HTTP ${res.status}`);
  const j = (await res.json()) as { roomId?: string };
  if (typeof j.roomId !== "string" || j.roomId.length === 0) {
    throw new Error("spectator/room: missing roomId");
  }
  return j.roomId;
}

async function fetchGhostRecord(
  registryBaseUrl: string,
  ghostId: string,
): Promise<RegistryGhostRecord | null> {
  const url = `${registryBaseUrl.replace(/\/$/, "")}/registry/ghosts/${encodeURIComponent(ghostId)}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return (await r.json()) as RegistryGhostRecord;
}

/** Start the encounter trigger. Idempotent against repeat starts — call
 *  once at boot. Returns a handle whose `close()` leaves the room. */
export async function startBarnacleEncounterTrigger(
  opts: EncounterTriggerOptions,
): Promise<EncounterTriggerHandle> {
  console.info(JSON.stringify({ kind: "barnacle.encounter-trigger.boot", phase: "resolving-room" }));
  const roomId = await resolveMatrixRoomId(opts.worldHttpBase);
  console.info(JSON.stringify({ kind: "barnacle.encounter-trigger.boot", phase: "joining-room", roomId }));
  const client = new Client(httpBaseToWsBase(opts.worldHttpBase));
  const room = await client.joinById(roomId, {
    name: "ghost-house-barnacle-encounter",
  });
  console.info(JSON.stringify({ kind: "barnacle.encounter-trigger.boot", phase: "joined-room", roomId }));

  // Local mirrors of Colyseus state we care about.
  /** ghostId → current cellId */
  const ghostPositions = new Map<string, string>();
  /** cellId → set of itemRefs on that tile */
  const tileItems = new Map<string, Set<string>>();
  /** Cells we've already triggered an encounter for, keyed by `${ghostId}|${platformId}` — prevents re-dispatching while a session is active for the same pair. */
  const inFlight = new Set<string>();
  /**
   * Decline cooldown: when a ghost said no to a platform, swallow
   * further encounters for that pair for COOLDOWN_MS. Without this,
   * a wandering ghost adjacent to the table loop-fires the brain
   * (and burns LLM calls) every position update.
   */
  const declinedAt = new Map<string, number>();
  const DECLINE_COOLDOWN_MS = 60_000;

  const PLATFORM_ITEM_PREFIXES = new Set([
    "PokerTable",
    // Future mini-game classes go here; eventually pulled from catalog.
  ]);

  /**
   * Capacity per platform class — used to compute `seatsOpen` for the
   * encounter payload so peppers' brain isn't told "6 open" when the
   * table is actually full. Hardcoded for v1; pull from the mini-game's
   * catalog manifest when more than one platform class exists.
   */
  const PLATFORM_CAPACITY: Readonly<Record<string, number>> = {
    PokerTable: 6,
  };

  function platformsAdjacentTo(cellId: string): Array<{
    platformId: string;
    platformClass: string;
    tileId: string;
  }> {
    // Disk of radius 1 = cell itself + its 6 neighbours. We INCLUDE
    // the cell itself — if a ghost wanders directly onto the platform
    // tile (e.g. PokerTable), still offer them the encounter. On accept
    // the supervisor withdraws them from the world so the "standing on
    // it" awkwardness resolves naturally. Without this, ghosts that
    // walk onto the tile silently pass through the saloon.
    let neighbours: string[];
    try {
      neighbours = gridDisk(cellId, 1);
    } catch {
      return [];
    }
    const platforms: Array<{ platformId: string; platformClass: string; tileId: string }> = [];
    for (const ncell of neighbours) {
      const refs = tileItems.get(ncell);
      if (!refs) continue;
      for (const ref of refs) {
        if (PLATFORM_ITEM_PREFIXES.has(ref)) {
          platforms.push({
            platformId: `${ref}:${ncell}`,
            platformClass: ref,
            tileId: ncell,
          });
        }
      }
    }
    return platforms;
  }

  async function tryDispatchEncounter(
    ghostId: string,
    platform: { platformId: string; platformClass: string; tileId: string },
  ): Promise<void> {
    const key = `${ghostId}|${platform.platformId}`;
    if (inFlight.has(key)) return;
    const declinedTs = declinedAt.get(key);
    if (declinedTs !== undefined && Date.now() - declinedTs < DECLINE_COOLDOWN_MS) {
      return;
    }

    // Need peppers's A2A endpoint — look up via the agent supervisor.
    const session = opts.agentSupervisor.getSessionByGhostId(ghostId);
    if (!session) return; // not adopted by this house

    // Need spawn cell — fetch from registry.
    const record = await fetchGhostRecord(opts.registryBaseUrl, ghostId);
    if (!record) {
      console.warn(
        JSON.stringify({
          kind: "barnacle.encounter-trigger.no-registry-record",
          ghostId,
        }),
      );
      return;
    }

    // Live seat counts: filter active mini-game sessions to this
    // specific platform. The supervisor knows because beginSession /
    // onCompleteReceived maintain the registry.
    const activeAtThisPlatform = opts.barnacleSupervisor
      .listActiveSessions()
      .filter((s) => s.platformId === platform.platformId);
    const seatsTotal = PLATFORM_CAPACITY[platform.platformClass] ?? 6;
    const seatsOpen = Math.max(0, seatsTotal - activeAtThisPlatform.length);
    const seatedNames = activeAtThisPlatform.map((s) => s.displayName);

    // If the table's full, don't even bother peppers — the brain would
    // accept and the rdc-poker-session would reject anyway, costing
    // an LLM call and a round-trip. Quietly skip and let the next
    // encounter trigger (when a seat opens) re-evaluate.
    if (seatsOpen === 0) {
      console.info(
        JSON.stringify({
          kind: "barnacle.encounter-trigger.skipped-full",
          ghostId,
          platformId: platform.platformId,
          seatedNames,
        }),
      );
      return;
    }

    inFlight.add(key);
    try {
      // Send the encounter to peppers via A2A.
      const peppersClient = await getBarnacleA2AClient(session.baseUrl, opts.devToken);
      const encounter: PlatformEncounter = {
        schema: PLATFORM_ENCOUNTER_SCHEMA,
        platformId: platform.platformId,
        ghostId,
        platformClass: platform.platformClass,
        seatsOpen,
        seatsTotal,
        seatedNames,
        setting: `${platform.platformClass} at ${platform.tileId.slice(-6)}`,
      };
      const replyData = await sendDataAndAwaitReply(
        peppersClient,
        encounter as unknown as Record<string, unknown>,
        { timeoutMs: 30_000 },
      );
      const reply = replyData as PlatformEncounterReply | null;
      if (!reply || reply.accept !== true) {
        declinedAt.set(key, Date.now());
        console.info(
          JSON.stringify({
            kind: "barnacle.encounter-declined",
            ghostId,
            platformId: platform.platformId,
            reasoning: reply?.reasoning ?? null,
            cooldownMs: DECLINE_COOLDOWN_MS,
          }),
        );
        return;
      }
      // On accept, clear the cooldown — the ghost is going in.
      declinedAt.delete(key);
      const personality: BarnaclePersonalitySnapshot =
        reply.personality ?? ({} as BarnaclePersonalitySnapshot);

      // Hand off to the supervisor — drives withdraw → pause → handoff.
      const result = await Effect.runPromise(
        opts.barnacleSupervisor.beginSession({
          ghostId,
          // Persistent identity flows through the handoff so the
          // mini-game (e.g. rdc-poker-session) labels the seat with
          // the same name peppers is using in social mode.
          displayName: session.displayName ?? session.agentId,
          personality,
          worldCredential: session.worldCredential,
          spawnCell: record.spawnH3Index,
          platformId: platform.platformId,
          platformClass: platform.platformClass,
          peppersBaseUrl: session.baseUrl,
        }),
      );
      if (!result.ok) {
        console.warn(
          JSON.stringify({
            kind: "barnacle.begin-session-failed",
            ghostId,
            platformClass: platform.platformClass,
            reason: result.reason,
          }),
        );
      } else {
        console.info(
          JSON.stringify({
            kind: "barnacle.encounter-accepted-handoff",
            ghostId,
            sessionId: result.session.sessionId,
            platformClass: platform.platformClass,
          }),
        );
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          kind: "barnacle.encounter-trigger.error",
          ghostId,
          platformId: platform.platformId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      // Allow re-trigger if the session ended (the in-flight latch is
      // released regardless of outcome; the supervisor's own session
      // tracking prevents double-seating).
      inFlight.delete(key);
    }
  }

  function onGhostMoved(ghostId: string, cellId: string): void {
    ghostPositions.set(ghostId, cellId);
    const platforms = platformsAdjacentTo(cellId);
    for (const p of platforms) {
      void tryDispatchEncounter(ghostId, p);
    }
  }

  function onTileItemsChanged(cellId: string, refs: string[]): void {
    if (refs.length === 0) {
      tileItems.delete(cellId);
      return;
    }
    tileItems.set(cellId, new Set(refs));
    // If any ghosts are already adjacent to this tile when the item
    // first appears, fire encounters for them.
    let hasPlatformItem = false;
    for (const r of refs) {
      if (PLATFORM_ITEM_PREFIXES.has(r)) {
        hasPlatformItem = true;
        break;
      }
    }
    if (!hasPlatformItem) return;
    let neighbours: string[];
    try {
      // Include the platform cell itself — same reasoning as
      // platformsAdjacentTo(): a ghost standing on the tile counts.
      neighbours = gridDisk(cellId, 1);
    } catch {
      return;
    }
    const neighSet = new Set(neighbours);
    for (const [gid, gcell] of ghostPositions) {
      if (!neighSet.has(gcell)) continue;
      const platforms = platformsAdjacentTo(gcell);
      for (const p of platforms) {
        if (p.tileId !== cellId) continue;
        void tryDispatchEncounter(gid, p);
      }
    }
  }

  // ghostTiles + tileItemRefs are MapSchemas. Same callback shape as the
  // rdc-orchestrator subscriber.
  const lastGhostCells = new Map<string, string>();
  function maybeFireGhost(ghostId: string, cellId: string): void {
    if (!ghostId || !cellId) return;
    if (lastGhostCells.get(ghostId) === cellId) return;
    lastGhostCells.set(ghostId, cellId);
    onGhostMoved(ghostId, cellId);
  }
  const lastTileItems = new Map<string, string>();
  function maybeFireTile(cellId: string, csv: string | undefined): void {
    const next = csv ?? "";
    if (lastTileItems.get(cellId) === next) return;
    lastTileItems.set(cellId, next);
    onTileItemsChanged(cellId, parseItemRefs(next));
  }

  // -------------------------------------------------------------------
  // Subscriptions.
  //
  // Ghost positions: use the room's `ghost-patch` broadcast (the world
  // emits this every setGhostCell, see MatrixRoom.emitGhostPatch). The
  // schema-observer approach (room.state.ghostTiles.onAdd) was silently
  // inert in practice — `room.state.ghostTiles` is undefined at the
  // moment we read it (state hasn't synced yet), and the optional
  // chains in the old code swallowed that. Message-based subscription
  // is reliable and matches what's being sent.
  //
  // Tile items: rarely change after startup (they're set once from the
  // loaded map). We still try the schema observer AFTER the first
  // state-sync; if that doesn't fire, we poll the state.tileItemRefs
  // MapSchema directly on each ghost-patch tick as a fallback.
  // -------------------------------------------------------------------

  let ghostPatchCount = 0;
  room.onMessage("ghost-patch", (payload: unknown) => {
    ghostPatchCount++;
    if (ghostPatchCount <= 3 || ghostPatchCount % 20 === 0) {
      const sample = payload && typeof payload === "object"
        ? Object.keys(payload as Record<string, unknown>).slice(0, 3)
        : [];
      console.info(JSON.stringify({
        kind: "barnacle.encounter-trigger.ghost-patch-received",
        count: ghostPatchCount,
        sampleGhostIds: sample,
      }));
    }
    if (!payload || typeof payload !== "object") return;
    for (const [ghostId, cellId] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof cellId === "string") maybeFireGhost(ghostId, cellId);
    }
    // Lazy tile-item population: read whatever the schema has now.
    syncTileItemsFromState();
  });

  let tileSyncCount = 0;
  function syncTileItemsFromState(): void {
    const state = room.state as unknown as {
      tileItemRefs?: {
        forEach?: (cb: (val: string, key: string) => void) => void;
        size?: number;
      };
    };
    tileSyncCount++;
    if (tileSyncCount <= 3) {
      const hasMap = state.tileItemRefs !== undefined;
      const size = state.tileItemRefs?.size ?? -1;
      const hasForEach = typeof state.tileItemRefs?.forEach === "function";
      console.info(JSON.stringify({
        kind: "barnacle.encounter-trigger.tile-sync",
        attempt: tileSyncCount,
        hasMap,
        size,
        hasForEach,
        tileItemsKnown: tileItems.size,
      }));
    }
    state.tileItemRefs?.forEach?.((csv, cellId) => maybeFireTile(cellId, csv));
  }

  // Belt + braces: hook the schema observer too, in case the room's
  // first state-sync hasn't happened yet. If onChange is defined it
  // fires when MapSchema entries are added/updated.
  const tryHookSchema = (): void => {
    const ghostTiles = (room.state as unknown as {
      ghostTiles?: {
        onAdd?: (cb: (val: string, key: string) => void) => void;
        onChange?: (cb: (val: string, key: string) => void) => void;
        forEach?: (cb: (val: string, key: string) => void) => void;
      };
    }).ghostTiles;
    if (ghostTiles) {
      ghostTiles.forEach?.((cellId, ghostId) => maybeFireGhost(ghostId, cellId));
      ghostTiles.onAdd?.((cellId, ghostId) => maybeFireGhost(ghostId, cellId));
      ghostTiles.onChange?.((cellId, ghostId) => maybeFireGhost(ghostId, cellId));
    }
    const tileItemRefs = (room.state as unknown as {
      tileItemRefs?: {
        onAdd?: (cb: (val: string, key: string) => void) => void;
        onChange?: (cb: (val: string, key: string) => void) => void;
        forEach?: (cb: (val: string, key: string) => void) => void;
      };
    }).tileItemRefs;
    if (tileItemRefs) {
      tileItemRefs.forEach?.((csv, cellId) => maybeFireTile(cellId, csv));
      tileItemRefs.onAdd?.((csv, cellId) => maybeFireTile(cellId, csv));
      tileItemRefs.onChange?.((csv, cellId) => maybeFireTile(cellId, csv));
    }
  };
  // Try now (works if state already synced) and again after the next
  // state change (works if it hadn't).
  tryHookSchema();
  (room as unknown as { onStateChange?: { once?: (cb: () => void) => void } })
    .onStateChange?.once?.(() => {
      tryHookSchema();
      syncTileItemsFromState();
    });

  console.info(
    JSON.stringify({
      kind: "barnacle.encounter-trigger.start",
      roomId,
      worldHttpBase: opts.worldHttpBase,
    }),
  );

  return {
    close: async () => {
      try {
        await room.leave();
      } catch {
        /* best effort */
      }
    },
  };
}
