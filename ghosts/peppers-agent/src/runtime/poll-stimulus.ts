/**
 * Convert raw world-state polling into typed `Stimulus` events.
 *
 * Priority on each tick:
 *   1. Inbox messages (utterances from other ghosts)
 *   2. New occupants on the current tile (cluster-entered)
 *   3. Items in view (mcguffin-in-view)
 *   4. Tile change (tile-entered)
 *   5. Nothing — return null.
 *
 * Caller passes a `StimulusContext` that's mutated each tick to
 * remember last-seen state.
 */

import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

import type { Compass, Stimulus } from "@aie-matrix/ghost-peppers-inner";

/** Mutable per-loop bookkeeping for stimulus diffing. */
export interface StimulusContext {
  lastTileH3: string | null;
  lastTileClass: string | null;
  knownOccupants: Set<string>;
  inspectedItems: Set<string>;
  /** Ghost id of the running peppers ghost — filtered out of cluster-entered. */
  selfGhostId: string | null;
  /** Registry base URL — needed to fetch message content for inbox notifications. */
  registryBase: string;
  /** Ghost-house id — used as the bearer for `/threads/{tid}/{mid}` reads. */
  ghostHouseId: string;
  /** Notifications fetched but not yet replayed as stimuli. */
  pendingMessages: Array<{ from: string; text: string }>;
  /** Log prefix passed to fetchMessage so diagnostics carry the ghost label. */
  logTag: string;
}

export function emptyStimulusContext(
  selfGhostId: string,
  registryBase: string,
  ghostHouseId: string,
  logTag = "peppers-house",
): StimulusContext {
  return {
    lastTileH3: null,
    lastTileClass: null,
    knownOccupants: new Set(),
    inspectedItems: new Set(),
    selfGhostId,
    registryBase,
    ghostHouseId,
    pendingMessages: [],
    logTag,
  };
}

function shortenGhostId(id: string): string {
  return id.length > 8 ? `ghost_${id.slice(0, 8)}` : id;
}

/**
 * Fetch the actual content of a message via the conversation server's
 * REST API. The MCP `inbox` tool only returns notification pointers
 * (`{thread_id, message_id}`) — the message body lives in the
 * conversation store and is read with the ghost-house's API key.
 *
 * Logs every failure path because silent drops here are the most
 * common source of "no incoming chat" reports.
 */
async function fetchMessage(
  registryBase: string,
  ghostHouseId: string,
  threadId: string,
  messageId: string,
  logTag: string,
): Promise<{ from: string; text: string } | null> {
  const url = `${registryBase}/threads/${encodeURIComponent(threadId)}/${encodeURIComponent(messageId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${ghostHouseId}` },
    });
  } catch (err) {
    console.warn(
      `[${logTag}] inbox: fetch threw for ${threadId}/${messageId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    console.warn(
      `[${logTag}] inbox: ${res.status} ${res.statusText} for ${threadId}/${messageId} :: ${body.slice(0, 200)}`,
    );
    return null;
  }
  let record: { name?: unknown; content?: unknown };
  try {
    record = (await res.json()) as { name?: unknown; content?: unknown };
  } catch (err) {
    console.warn(
      `[${logTag}] inbox: bad JSON for ${threadId}/${messageId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const content = typeof record.content === "string" ? record.content : null;
  if (content === null || content.length === 0) {
    console.warn(
      `[${logTag}] inbox: empty/missing content for ${threadId}/${messageId}`,
    );
    return null;
  }
  const fromRaw = typeof record.name === "string" ? record.name : threadId;
  return { from: shortenGhostId(fromRaw), text: content };
}

interface InboxResult {
  readonly notifications?: ReadonlyArray<{
    readonly thread_id?: string;
    readonly message_id?: string;
  }>;
}

interface LookHere {
  readonly tileId?: string;
  readonly tileClass?: string;
  readonly occupants?: ReadonlyArray<string>;
  readonly objects?: ReadonlyArray<{ id?: string; at?: string }>;
}

interface LookAround {
  readonly neighbors?: ReadonlyArray<{
    readonly tileId?: string;
    readonly tileClass?: string;
    readonly occupants?: ReadonlyArray<string>;
    readonly objects?: ReadonlyArray<{ id?: string; at?: string }>;
  }>;
}

interface WhereAmIResult {
  readonly tileId?: string;
  readonly h3Index?: string;
}

/**
 * Poll the world once and return the highest-priority stimulus, or
 * null if nothing has changed worth reacting to.
 */
export async function pollNextStimulus(
  client: GhostMcpClient,
  ctx: StimulusContext,
): Promise<Stimulus | null> {
  // 1. Utterances waiting in the inbox. Notifications are pointers
  //    (`thread_id` + `message_id`); the message body is fetched
  //    separately from the conversation server's `/threads/...`
  //    endpoint using the ghost-house API key.
  if (ctx.pendingMessages.length === 0) {
    try {
      const inbox = (await client.inbox()) as InboxResult;
      const notes = inbox.notifications ?? [];
      if (notes.length > 0) {
        console.info(
          `[${ctx.logTag}] inbox: ${notes.length} notification(s) — fetching content…`,
        );
      }
      for (const n of notes) {
        if (typeof n.thread_id !== "string" || typeof n.message_id !== "string") continue;
        const msg = await fetchMessage(
          ctx.registryBase,
          ctx.ghostHouseId,
          n.thread_id,
          n.message_id,
          ctx.logTag,
        );
        if (msg !== null) {
          console.info(
            `[${ctx.logTag}] inbox: queued utterance from ${msg.from} :: "${msg.text.slice(0, 80)}${msg.text.length > 80 ? "…" : ""}"`,
          );
          ctx.pendingMessages.push(msg);
        }
      }
    } catch (err) {
      console.warn(
        `[${ctx.logTag}] inbox: poll threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const next = ctx.pendingMessages.shift();
  if (next !== undefined) {
    return { kind: "utterance", from: next.from, text: next.text };
  }

  // 2 & 3. Look here AND around — combine into a 7-cell cluster view.
  // `look here` shows same-tile occupants + items; `look around`
  // shows occupants and items on each neighboring tile. RFC-0005
  // defines a ghost's social cluster as the 7-cell area (current +
  // neighbors), so we treat this as the unit of awareness.
  let look: LookHere | null = null;
  try {
    look = (await client.callTool("look", { at: "here" })) as LookHere;
  } catch {
    look = null;
  }
  let lookAround: LookAround | null = null;
  try {
    lookAround = (await client.callTool("look", { at: "around" })) as LookAround;
  } catch {
    lookAround = null;
  }

  // Build the full cluster occupant set, excluding self.
  const clusterOccupants = new Set<string>();
  if (look) {
    for (const g of look.occupants ?? []) {
      if (g !== ctx.selfGhostId) clusterOccupants.add(g);
    }
  }
  if (lookAround) {
    for (const n of lookAround.neighbors ?? []) {
      for (const g of n.occupants ?? []) {
        if (g !== ctx.selfGhostId) clusterOccupants.add(g);
      }
    }
  }

  // Diff against last tick to emit cluster-entered / cluster-left.
  const prev = new Set(ctx.knownOccupants);
  const arrived: string[] = [];
  for (const g of clusterOccupants) {
    if (!prev.has(g)) arrived.push(g);
  }
  const departed: string[] = [];
  for (const g of prev) {
    if (!clusterOccupants.has(g)) departed.push(g);
  }
  ctx.knownOccupants = clusterOccupants;

  if (arrived.length > 0) {
    return {
      kind: "cluster-entered",
      ghostIds: arrived.map(shortenGhostId),
    };
  }
  if (departed.length > 0) {
    return {
      kind: "cluster-left",
      ghostIds: departed.map(shortenGhostId),
    };
  }

  // Items in view — same-tile first, then neighbor-tile mcguffins.
  if (look) {
    for (const obj of look.objects ?? []) {
      if (typeof obj.id !== "string" || ctx.inspectedItems.has(obj.id)) continue;
      ctx.inspectedItems.add(obj.id);
      const at = isCompass(obj.at) || obj.at === "here" ? obj.at : "here";
      return { kind: "mcguffin-in-view", itemRef: obj.id, at: at as "here" | Compass };
    }
  }

  // 4. Tile change.
  try {
    const here = (await client.callTool("whereami", {})) as WhereAmIResult;
    const h3 = here.h3Index ?? null;
    if (h3 !== null && h3 !== ctx.lastTileH3) {
      const lookHere = look ?? ((await client.callTool("look", { at: "here" })) as LookHere);
      const tileClass = lookHere.tileClass ?? "Tile";
      ctx.lastTileH3 = h3;
      ctx.lastTileClass = tileClass;
      return { kind: "tile-entered", h3Index: h3, tileClass };
    }
  } catch {
    /* fall through */
  }

  return null;
}

function isCompass(v: unknown): v is Compass {
  return v === "n" || v === "s" || v === "ne" || v === "nw" || v === "se" || v === "sw";
}
