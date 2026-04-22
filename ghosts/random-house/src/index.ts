import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const DEFAULT_REGISTRY_BASE = "http://127.0.0.1:8787";
const DEFAULT_WALK_INTERVAL_MS = 1500;
const DEFAULT_ITEM_DROP_PROB = 0.3;
const DEFAULT_GHOST_COUNT = 1;

export interface RandomHouseCli {
  readonly registryBase: string;
  readonly walkIntervalMs: number;
  readonly itemDropProb: number;
  readonly ghostCount: number;
}

function printHelpAndExit(): never {
  console.log(`Usage: random-house [options]

Options:
  -h, --help                    Show this help
  -r, --registry-base <url>     HTTP root for /registry/* (default: ${DEFAULT_REGISTRY_BASE})
      --walk-interval-ms <n>   Delay between walker ticks in ms (default: ${DEFAULT_WALK_INTERVAL_MS})
      --drop-prob <n>          After take: probability 0..1 to drop one random item (default: ${DEFAULT_ITEM_DROP_PROB})
  -n, --ghosts <n>             Number of ghosts, 1..32 (default: ${DEFAULT_GHOST_COUNT})

Long options also support =value, e.g. --ghosts=2, --drop-prob=0.5
`);
  process.exit(0);
}

function parsePositiveInt(name: string, raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    throw new Error(`${name} requires a value`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${name} expects a positive integer, got: ${String(raw)}`);
  }
  return Math.trunc(n);
}

function parseUnitInterval(name: string, raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    throw new Error(`${name} requires a value`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${name} expects a number from 0 to 1, got: ${String(raw)}`);
  }
  return n;
}

function parseGhostCountValue(raw: string | undefined): number {
  const n = parsePositiveInt("--ghosts", raw);
  return Math.min(32, n);
}

/** Parse argv (typically `process.argv.slice(2)`). No environment-variable overrides. */
export function parseRandomHouseCli(argv: string[]): RandomHouseCli {
  let registryBase = DEFAULT_REGISTRY_BASE;
  let walkIntervalMs = DEFAULT_WALK_INTERVAL_MS;
  let itemDropProb = DEFAULT_ITEM_DROP_PROB;
  let ghostCount = DEFAULT_GHOST_COUNT;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    // `pnpm run start -- <args>` forwards a literal `--`; npm strips it. Accept both.
    if (a === "--") {
      continue;
    }
    if (a === "-h" || a === "--help") {
      printHelpAndExit();
    }
    if (a.startsWith("--registry-base=")) {
      registryBase = a.slice("--registry-base=".length);
      continue;
    }
    if (a === "--registry-base" || a === "-r") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) {
        throw new Error("--registry-base requires a URL");
      }
      registryBase = v;
      i++;
      continue;
    }
    if (a.startsWith("--walk-interval-ms=")) {
      walkIntervalMs = parsePositiveInt("walk-interval-ms", a.slice("--walk-interval-ms=".length));
      continue;
    }
    if (a === "--walk-interval-ms") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) {
        throw new Error("--walk-interval-ms requires a number (ms)");
      }
      walkIntervalMs = parsePositiveInt("walk-interval-ms", v);
      i++;
      continue;
    }
    if (a.startsWith("--drop-prob=")) {
      itemDropProb = parseUnitInterval("drop-prob", a.slice("--drop-prob=".length));
      continue;
    }
    if (a === "--drop-prob") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) {
        throw new Error("--drop-prob requires a number from 0 to 1");
      }
      itemDropProb = parseUnitInterval("drop-prob", v);
      i++;
      continue;
    }
    if (a.startsWith("--ghosts=")) {
      ghostCount = parseGhostCountValue(a.slice("--ghosts=".length));
      continue;
    }
    if (a === "--ghosts" || a === "-n") {
      const v = argv[i + 1];
      if (!v || v.startsWith("-")) {
        throw new Error("--ghosts / -n requires a number");
      }
      ghostCount = parseGhostCountValue(v);
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a} (try --help)`);
    }
    throw new Error(`Unexpected argument: ${a} (try --help)`);
  }

  return {
    registryBase,
    walkIntervalMs,
    itemDropProb: Math.min(1, Math.max(0, itemDropProb)),
    ghostCount,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchErrnoCode(err: unknown): string | undefined {
  const cause =
    err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  if (!cause || typeof cause !== "object" || !("code" in cause)) {
    return undefined;
  }
  return String((cause as { code?: unknown }).code);
}

async function postJson<T>(base: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const code = fetchErrnoCode(e);
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      throw new Error(
        `Cannot reach registry at ${base} (${code}). ` +
          `Start the PoC HTTP server first, then retry (e.g. pnpm --filter @aie-matrix/server run dev).`,
      );
    }
    throw e;
  }
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Non-JSON response (${res.status}): ${text}`);
    }
  }
  if (!res.ok) {
    throw new Error(`Registry ${path} failed (${res.status}): ${text}`);
  }
  return data as T;
}

const CANNED_LINES = [
  "hey there",
  "hello!",
  "oh— hi",
  "anyone around?",
  "nice spot",
  "didn't expect company",
];

function takeCanned(): string {
  return CANNED_LINES[Math.floor(Math.random() * CANNED_LINES.length)]!;
}

function parseOccupantsFromLook(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const occ = (raw as { occupants?: unknown }).occupants;
  if (!Array.isArray(occ)) {
    return [];
  }
  return occ.filter((x): x is string => typeof x === "string");
}

/** `look { at: "here" }` object summaries on the current tile only. */
function objectRefsOnHereFromLook(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const objects = (raw as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) {
    return [];
  }
  const ids: string[] = [];
  for (const o of objects) {
    if (!o || typeof o !== "object") {
      continue;
    }
    const at = (o as { at?: unknown }).at;
    const id = (o as { id?: unknown }).id;
    if (at === "here" && typeof id === "string" && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}

function isTakeSuccess(raw: unknown): raw is { ok: true; name: string } {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "ok" in raw &&
    (raw as { ok: unknown }).ok === true &&
    "name" in raw &&
    typeof (raw as { name: unknown }).name === "string"
  );
}

function inventoryCarriedItems(raw: unknown): { itemRef: string; name: string }[] {
  if (!raw || typeof raw !== "object" || (raw as { ok?: unknown }).ok !== true) {
    return [];
  }
  const objects = (raw as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) {
    return [];
  }
  const out: { itemRef: string; name: string }[] = [];
  for (const o of objects) {
    if (!o || typeof o !== "object") {
      continue;
    }
    const itemRef = (o as { itemRef?: unknown }).itemRef;
    const name = (o as { name?: unknown }).name;
    if (typeof itemRef === "string" && itemRef.length > 0 && typeof name === "string") {
      out.push({ itemRef, name });
    }
  }
  return out;
}

/**
 * Picks up every carriable item on the current tile (retries `look` after each successful `take`).
 * `seedLook` avoids an extra `look` when the caller just fetched it (e.g. before `go`).
 */
async function takeAllCarriableOnTile(
  mcp: GhostMcpClient,
  ghostLabel: string,
  seedLook?: unknown,
): Promise<void> {
  let useSeed: unknown | undefined = seedLook;
  for (;;) {
    const lookRaw = useSeed !== undefined ? useSeed : await mcp.callTool("look", { at: "here" });
    useSeed = undefined;
    const here = objectRefsOnHereFromLook(lookRaw);
    if (here.length === 0) {
      return;
    }
    let took = false;
    for (const itemRef of here) {
      const res = await mcp.callTool("take", { itemRef });
      if (isTakeSuccess(res)) {
        console.log(`[${ghostLabel}] take`, itemRef, res.name);
        took = true;
        break;
      }
    }
    if (!took) {
      return;
    }
  }
}

/** After items are picked up, optionally drop one random carried item. */
async function maybeRandomDrop(
  mcp: GhostMcpClient,
  ghostLabel: string,
  itemDropProb: number,
): Promise<void> {
  if (Math.random() >= itemDropProb) {
    return;
  }
  const inv = await mcp.callTool("inventory", {});
  const carried = inventoryCarriedItems(inv);
  if (carried.length === 0) {
    return;
  }
  const pick = carried[Math.floor(Math.random() * carried.length)]!;
  const res = await mcp.callTool("drop", { itemRef: pick.itemRef });
  const ok = typeof res === "object" && res !== null && "ok" in res && (res as { ok: unknown }).ok === true;
  if (ok) {
    console.log(`[${ghostLabel}] drop`, pick.itemRef, pick.name);
  } else {
    console.log(`[${ghostLabel}] drop`, pick.itemRef, "failed", res);
  }
}

/** `look` at here, take carriable items, maybe drop — used after every `go` and once before the first `go` each tick. */
async function lookTakeMaybeDrop(
  mcp: GhostMcpClient,
  ghostLabel: string,
  itemDropProb: number,
  seedLook?: unknown,
): Promise<void> {
  await takeAllCarriableOnTile(mcp, ghostLabel, seedLook);
  await maybeRandomDrop(mcp, ghostLabel, itemDropProb);
}

function goFailureCode(msg: string): string | undefined {
  try {
    return (JSON.parse(msg) as { code?: string }).code;
  } catch {
    return undefined;
  }
}

async function runWalker(
  mcp: GhostMcpClient,
  ghostLabel: string,
  getRunning: () => boolean,
  walkIntervalMs: number,
  itemDropProb: number,
): Promise<void> {
  let mode: "normal" | "conversational" = "normal";

  // Bye after this many idle ticks (no new messages), regardless of random roll.
  const IDLE_TICKS_BEFORE_BYE = 2;
  // Bye unconditionally after this many total conversational ticks, even mid-conversation.
  const MAX_CONVERSATION_TICKS = 6;
  let idleTicks = 0;
  let conversationTicks = 0;

  while (getRunning()) {
    if (mode === "conversational") {
      try {
        const inboxRes = await mcp.inbox();
        conversationTicks++;
        const mustLeave =
          conversationTicks >= MAX_CONVERSATION_TICKS ||
          idleTicks >= IDLE_TICKS_BEFORE_BYE;

        if (inboxRes.notifications.length > 0 && !mustLeave) {
          idleTicks = 0;
          const reply = takeCanned();
          await mcp.say(reply);
          console.log(`[${ghostLabel}] say (reply)`, reply);
        } else {
          if (inboxRes.notifications.length === 0) idleTicks++;
          // 50% chance to leave each idle tick; forced out at the caps above.
          if (mustLeave || Math.random() < 0.5) {
            await mcp.bye();
            mode = "normal";
            idleTicks = 0;
            conversationTicks = 0;
            console.log(`[${ghostLabel}] bye`);
          }
        }
      } catch (e) {
        console.warn(`[${ghostLabel}] conversation tick failed`, e);
        // Defensively exit conversational mode so the ghost doesn't stay stuck.
        mode = "normal";
        idleTicks = 0;
        conversationTicks = 0;
      }
      await delay(walkIntervalMs);
      continue;
    }

    const lookRaw = await mcp.callTool("look", { at: "here" });
    const occupants = parseOccupantsFromLook(lookRaw);
    if (occupants.length > 0 && Math.random() < 0.2) {
      try {
        const msg = takeCanned();
        await mcp.say(msg);
        mode = "conversational";
        idleTicks = 0;
        conversationTicks = 0;
        console.log(`[${ghostLabel}] say (opening)`, msg, `occupants=${occupants.length}`);
      } catch (e) {
        console.warn(`[${ghostLabel}] say failed`, e);
      }
      await delay(walkIntervalMs);
      continue;
    }

    try {
      await lookTakeMaybeDrop(mcp, ghostLabel, itemDropProb, lookRaw);
    } catch (e) {
      console.warn(`[${ghostLabel}] look/take/drop (before go) failed`, e);
    }

    const exits = (await mcp.callTool("exits", {})) as {
      exits: { toward: string; tileId: string }[];
    };
    if (!exits.exits.length) {
      console.warn(`[${ghostLabel}] No exits — stopping walker`);
      break;
    }
    const pick = exits.exits[Math.floor(Math.random() * exits.exits.length)]!;
    try {
      const moved = (await mcp.callTool("go", { toward: pick.toward })) as { ok?: boolean };
      console.log(`[${ghostLabel}] go`, pick.toward, moved);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = goFailureCode(msg);
      if (code === "RULESET_DENY" || code === "NO_NEIGHBOR" || code === "MAP_INTEGRITY") {
        console.log(`[${ghostLabel}] go`, pick.toward, "denied", code);
      } else if (code === "TILE_FULL") {
        console.log(`[${ghostLabel}] go`, pick.toward, "denied", code);
      } else if (code === "IN_CONVERSATION") {
        // Server says we're conversational — local state was wrong; correct it.
        mode = "conversational";
        idleTicks = 0;
        conversationTicks = 0;
        console.log(`[${ghostLabel}] go`, pick.toward, "denied", code, "— syncing local mode");
      } else {
        console.warn(`[${ghostLabel}] go failed`, pick.toward, e);
      }
    }

    try {
      await lookTakeMaybeDrop(mcp, ghostLabel, itemDropProb);
    } catch (e) {
      console.warn(`[${ghostLabel}] look/take/drop (after go) failed`, e);
    }

    await delay(walkIntervalMs);
  }
  await mcp.disconnect();
}

async function main(): Promise<void> {
  const cli = parseRandomHouseCli(process.argv.slice(2));
  const { ghostCount, walkIntervalMs, itemDropProb, registryBase } = cli;

  const { ghostHouseId } = await postJson<{ ghostHouseId: string }>(registryBase, "/registry/houses", {
    displayName: "random-house",
  });

  const walkers: { mcp: GhostMcpClient; label: string }[] = [];
  for (let i = 0; i < ghostCount; i++) {
    const { caretakerId } = await postJson<{ caretakerId: string }>(registryBase, "/registry/caretakers", {
      label: `random-house-walker-${i}`,
    });
    const adopt = await postJson<{
      ghostId: string;
      caretakerId: string;
      credential: { token: string; worldApiBaseUrl: string; transport: string };
    }>(registryBase, "/registry/adopt", { caretakerId, ghostHouseId });

    const mcp = new GhostMcpClient({
      worldApiBaseUrl: adopt.credential.worldApiBaseUrl,
      token: adopt.credential.token,
    });
    await mcp.connect();
    const label = adopt.ghostId.length > 10 ? `${adopt.ghostId.slice(0, 10)}…` : adopt.ghostId;
    walkers.push({ mcp, label });

    console.log(`[${i + 1}/${ghostCount} ${label}] whoami`, await mcp.callTool("whoami", {}));
    console.log(`[${i + 1}/${ghostCount} ${label}] whereami`, await mcp.callTool("whereami", {}));
  }

  let running = true;
  const stop = (): void => {
    running = false;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(
    `random-house: ${ghostCount} ghost(s), every ${walkIntervalMs}ms, drop prob ${itemDropProb}, registry ${registryBase} — Ctrl+C to stop`,
  );

  await Promise.all(
    walkers.map(({ mcp, label }) => runWalker(mcp, label, () => running, walkIntervalMs, itemDropProb)),
  );

  console.log("random-house walk stopped");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
