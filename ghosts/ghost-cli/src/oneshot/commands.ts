import { Cause, Console, Effect } from "effect";

import type { GhostConfig } from "../config.js";
import { GhostConfigLive } from "../config.js";
import { runPreflight } from "../preflight/index.js";
import type { PreFlightError } from "../preflight/errors.js";
import {
  GhostClientService,
  type GhostClientError,
  type GhostToolName,
} from "../services/GhostClientService.js";

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
  return JSON.stringify(raw, null, 2);
}

function formatExits(raw: unknown): string {
  return JSON.stringify(raw, null, 2);
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
}): Effect.Effect<void, PreFlightError | GhostClientError, GhostConfigLive | GhostClientService> =>
  Effect.gen(function* () {
    const cfg = input.config;
    const svc = yield* GhostClientService;

    const raw = yield* runPreflight(cfg).pipe(
      Effect.flatMap(() =>
        svc.callTool(input.tool, input.args ?? {}).pipe(
          Effect.tapErrorCause((c) =>
            cfg.debug ? Console.error(`[ghost-cli debug] cause:\n${Cause.pretty(c)}`) : Effect.void,
          ),
        ),
      ),
    );

    yield* emitDebug(cfg, "raw tool result", raw);

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
): Effect.Effect<void, PreFlightError | GhostClientError, GhostConfigLive | GhostClientService> => {
  const normalized = at.trim().toLowerCase();
  if (normalized !== "here" && normalized !== "around" && !isFace(normalized)) {
    return Effect.gen(function* () {
      yield* Console.error(`Invalid look target "${at}". Use here, around, or a face (n, s, ne, nw, se, sw).`);
      yield* Effect.sync(() => process.exit(1));
    });
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
): Effect.Effect<void, PreFlightError | GhostClientError, GhostConfigLive | GhostClientService> => {
  const t = toward.trim().toLowerCase();
  if (!isFace(t)) {
    return Effect.gen(function* () {
      yield* Console.error(`Invalid direction "${toward}". Use one of: n, s, ne, nw, se, sw.`);
      yield* Effect.sync(() => process.exit(1));
    });
  }
  return runOneshotTool({ config, tool: "go", args: { toward: t } });
};
