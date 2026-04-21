import { Cause, Console, Effect } from "effect";

import type { GhostConfig } from "../config.js";
import { GhostConfigLive } from "../config.js";
import { runPreflight } from "../preflight/index.js";
import type { PreFlightError } from "../preflight/errors.js";
import {
  GhostClientService,
  NetworkError,
  type GhostClientError,
  type GhostToolName,
} from "../services/GhostClientService.js";
import { parseExitList, parseTileView } from "../repl/mcp-result.js";
import { CliSilentExit, CliUsageError, type OneshotCliError } from "./errors.js";

const FACES = new Set(["n", "s", "ne", "nw", "se", "sw"]);

function isFace(s: string): boolean {
  return FACES.has(s.trim().toLowerCase());
}

function formatWhoami(raw: unknown): string {
  if (raw && typeof raw === "object" && "ghostId" in raw && typeof (raw as { ghostId: unknown }).ghostId === "string") {
    const o = raw as { ghostId: string; caretakerId?: string };
    let out = `ghostId: ${o.ghostId}`;
    if (typeof o.caretakerId === "string") {
      out += `\ncaretakerId: ${o.caretakerId}`;
    }
    return out;
  }
  return JSON.stringify(raw);
}

function formatWhereami(raw: unknown): string {
  if (raw && typeof raw === "object" && "tileId" in raw) {
    const o = raw as { tileId: unknown; col?: unknown; row?: unknown };
    const tileId = String(o.tileId);
    const col = typeof o.col === "number" ? o.col : "?";
    const row = typeof o.row === "number" ? o.row : "?";
    return `tileId: ${tileId}\ncol: ${col}\nrow: ${row}`;
  }
  return JSON.stringify(raw);
}

function formatLook(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return "(nothing to see)";
  }
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item, i) => {
        const block = formatLook(item);
        return raw.length > 1 ? `— neighbour ${i + 1} —\n${block}` : block;
      })
      .join("\n\n");
  }
  if (typeof raw === "object") {
    const tv = parseTileView(raw);
    if (tv) {
      return tv.prose;
    }
  }
  return JSON.stringify(raw, null, 2);
}

function formatExits(raw: unknown): string {
  const parsed = parseExitList(raw);
  if (parsed === null || !parsed.exits.length) {
    return "No traversable exits from here.";
  }
  return ["Exits:", ...parsed.exits.map((e) => `  ${e.toward} → ${e.tileId}`)].join("\n");
}

export function isGoStructuredFailure(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const o = raw as Record<string, unknown>;
  return "ok" in o && o.ok === false;
}

function formatGo(raw: unknown): string {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("ok" in o && o.ok === false) {
      const code = typeof o.code === "string" ? o.code : "BLOCKED";
      const reason = typeof o.reason === "string" ? o.reason : "Movement was denied.";
      return `Movement denied (${code}): ${reason}`;
    }
  }
  return JSON.stringify(raw, null, 2);
}

function formatSay(raw: unknown): string {
  if (raw && typeof raw === "object" && "message_id" in raw) {
    const o = raw as { message_id: string; mx_listeners?: unknown };
    const listeners = Array.isArray(o.mx_listeners)
      ? o.mx_listeners.filter((x): x is string => typeof x === "string")
      : [];
    return [`message_id: ${o.message_id}`, `mx_listeners: ${listeners.join(", ") || "(none)"}`].join("\n");
  }
  return JSON.stringify(raw, null, 2);
}

function formatBye(raw: unknown): string {
  if (raw && typeof raw === "object" && "previous_mode" in raw) {
    const o = raw as { previous_mode: string };
    return `previous_mode: ${o.previous_mode}`;
  }
  return JSON.stringify(raw, null, 2);
}

function formatInbox(raw: unknown): string {
  if (raw && typeof raw === "object" && "notifications" in raw) {
    const o = raw as { notifications: unknown };
    if (!Array.isArray(o.notifications) || o.notifications.length === 0) {
      return "(no pending notifications)";
    }
    return o.notifications
      .map((n) => {
        if (n && typeof n === "object" && "thread_id" in n && "message_id" in n) {
          const r = n as { thread_id: unknown; message_id: unknown };
          return `message.new thread_id=${String(r.thread_id)} message_id=${String(r.message_id)}`;
        }
        return JSON.stringify(n);
      })
      .join("\n");
  }
  return JSON.stringify(raw, null, 2);
}

function formatProse(tool: GhostToolName, raw: unknown): string {
  switch (tool) {
    case "whoami":
      return formatWhoami(raw);
    case "whereami":
      return formatWhereami(raw);
    case "look":
      return formatLook(raw);
    case "exits":
      return formatExits(raw);
    case "go":
      return formatGo(raw);
    case "say":
      return formatSay(raw);
    case "bye":
      return formatBye(raw);
    case "inbox":
      return formatInbox(raw);
  }
}

const emitDebug = (cfg: GhostConfig, label: string, payload: unknown) =>
  cfg.debug
    ? Console.error(`[ghost-cli debug] ${label}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`)
    : Effect.void;

export const runOneshotTool = (input: {
  readonly config: GhostConfig;
  readonly tool: GhostToolName;
  readonly args?: Record<string, unknown>;
}): Effect.Effect<
  void,
  PreFlightError | GhostClientError | OneshotCliError,
  GhostConfigLive | GhostClientService
> =>
  Effect.gen(function* () {
    const cfg = input.config;

    yield* runPreflight({ token: cfg.token, url: cfg.url });

    const svc = yield* GhostClientService;

    const callOnce = () =>
      svc.callTool(input.tool, input.args ?? {}).pipe(
        Effect.tapErrorCause((c) =>
          cfg.debug ? Console.error(`[ghost-cli debug] cause:\n${Cause.pretty(c)}`) : Effect.void,
        ),
      );

    const raw = yield* Effect.gen(function* () {
      const first = yield* callOnce().pipe(Effect.either);
      if (first._tag === "Right") {
        return first.right;
      }
      if (first.left instanceof NetworkError) {
        const second = yield* callOnce().pipe(Effect.either);
        if (second._tag === "Right") {
          return second.right;
        }
        return yield* Effect.fail(second.left);
      }
      return yield* Effect.fail(first.left);
    });

    yield* emitDebug(cfg, "raw tool result", raw);

    if (input.tool === "go" && isGoStructuredFailure(raw)) {
      if (cfg.json) {
        yield* Console.log(JSON.stringify(raw));
      } else {
        yield* Console.log(formatProse(input.tool, raw));
      }
      return yield* Effect.fail(new CliSilentExit({ exitCode: 1 }));
    }

    if (cfg.json) {
      yield* Console.log(JSON.stringify(raw));
    } else {
      yield* Console.log(formatProse(input.tool, raw));
    }
  });

export const runWhoami = (config: GhostConfig) => runOneshotTool({ config, tool: "whoami" });

export const runWhereami = (config: GhostConfig) => runOneshotTool({ config, tool: "whereami" });

export const runLook = (
  config: GhostConfig,
  at: string,
): Effect.Effect<
  void,
  PreFlightError | GhostClientError | OneshotCliError,
  GhostConfigLive | GhostClientService
> => {
  const normalized = at.trim().toLowerCase();
  if (normalized !== "here" && normalized !== "around" && !isFace(normalized)) {
    return Effect.fail(
      new CliUsageError({
        message: `Invalid look target "${at}". Use here, around, or a face (n, s, ne, nw, se, sw).`,
      }),
    );
  }
  return runOneshotTool({
    config,
    tool: "look",
    args: { at: normalized },
  });
};

export const runExits = (config: GhostConfig) => runOneshotTool({ config, tool: "exits" });

export const runGo = (
  config: GhostConfig,
  toward: string,
): Effect.Effect<
  void,
  PreFlightError | GhostClientError | OneshotCliError,
  GhostConfigLive | GhostClientService
> => {
  const t = toward.trim().toLowerCase();
  if (!isFace(t)) {
    return Effect.fail(
      new CliUsageError({
        message: `Invalid direction "${toward}". Use one of: n, s, ne, nw, se, sw.`,
      }),
    );
  }
  return runOneshotTool({ config, tool: "go", args: { toward: t } });
};

export const runSay = (
  config: GhostConfig,
  words: readonly string[],
): Effect.Effect<
  void,
  PreFlightError | GhostClientError | OneshotCliError,
  GhostConfigLive | GhostClientService
> => {
  const content = words.join(" ").trim();
  if (!content) {
    return Effect.fail(
      new CliUsageError({
        message: 'say requires message text. Example: ghost-cli say "hello from the fair"',
      }),
    );
  }
  return runOneshotTool({ config, tool: "say", args: { content } });
};

export const runBye = (config: GhostConfig) => runOneshotTool({ config, tool: "bye" });
