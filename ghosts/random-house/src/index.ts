import { GhostMcpClient } from "@aie-matrix/ghost-ts-client";
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const registryBase = process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787";

const walkIntervalMs = Number(process.env.AIE_MATRIX_WALK_INTERVAL_MS ?? "1500");

function parseGhostCount(): number {
  let raw: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--ghosts=")) {
      raw = arg.slice("--ghosts=".length);
      break;
    }
    if (arg === "--ghosts" || arg === "-n") {
      raw = argv[i + 1];
      break;
    }
  }
  raw ??= process.env.AIE_MATRIX_GHOST_COUNT;
  const n = Number(raw ?? "1");
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(
      `Invalid ghost count: ${String(raw)} (use --ghosts=N, -n N, or AIE_MATRIX_GHOST_COUNT, integer >= 1)`,
    );
  }
  return Math.min(32, Math.trunc(n));
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${registryBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const code = fetchErrnoCode(e);
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      throw new Error(
        `Cannot reach registry at ${registryBase} (${code}). ` +
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
    await delay(walkIntervalMs);
  }
  await mcp.disconnect();
}

async function main(): Promise<void> {
  const ghostCount = parseGhostCount();

  const { ghostHouseId } = await postJson<{ ghostHouseId: string }>("/registry/houses", {
    displayName: "random-house",
  });

  const walkers: { mcp: GhostMcpClient; label: string }[] = [];
  for (let i = 0; i < ghostCount; i++) {
    const { caretakerId } = await postJson<{ caretakerId: string }>("/registry/caretakers", {
      label: `random-house-walker-${i}`,
    });
    const adopt = await postJson<{
      ghostId: string;
      caretakerId: string;
      credential: { token: string; worldApiBaseUrl: string; transport: string };
    }>("/registry/adopt", { caretakerId, ghostHouseId });

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
    `random-house: ${ghostCount} ghost(s), walking every ${walkIntervalMs}ms (AIE_MATRIX_WALK_INTERVAL_MS); Ctrl+C to stop`,
  );

  await Promise.all(walkers.map(({ mcp, label }) => runWalker(mcp, label, () => running)));

  console.log("random-house walk stopped");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
