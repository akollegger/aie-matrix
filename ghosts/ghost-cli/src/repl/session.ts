import { Deferred, Duration, Effect, Layer, Queue, Ref } from "effect";

import type { GhostConfig } from "../config.js";
import { makeGhostConfigLayer } from "../config.js";
import { formatDiagnostic } from "../diagnostics.js";
import { runPreflight } from "../preflight/index.js";
import type { PreFlightError } from "../preflight/errors.js";
import {
  GhostClientLayer,
  GhostClientService,
  NetworkError,
  ProtocolError,
  ToolError,
} from "../services/GhostClientService.js";
import {
  formatGoLogMessage,
  parseExitList,
  parseGhostIdentity,
  parseGhostPosition,
  parseTileView,
} from "./mcp-result.js";
import type { ReplCommand, ReplRefs } from "./repl-state.js";
import { parseReplCommand } from "./repl-state.js";

const HELP_TEXT =
  "Commands: whoami | whereami | look [here|around|n|s|ne|nw|se|sw] | exits | go <face> | say <message> | bye | help | exit";

function formatSayLogLine(raw: unknown): string {
  if (raw && typeof raw === "object" && "message_id" in raw) {
    const o = raw as { message_id: string; mx_listeners?: unknown };
    const listeners = Array.isArray(o.mx_listeners)
      ? o.mx_listeners.filter((x): x is string => typeof x === "string").join(", ")
      : "";
    return `say ok — id ${o.message_id}; listeners: ${listeners || "(none)"}`;
  }
  return `say: ${JSON.stringify(raw)}`;
}

function notificationsFromInbox(raw: unknown): ReadonlyArray<{ thread_id: string; message_id: string }> {
  if (!raw || typeof raw !== "object" || !("notifications" in raw)) {
    return [];
  }
  const n = (raw as { notifications: unknown }).notifications;
  if (!Array.isArray(n)) {
    return [];
  }
  const out: Array<{ thread_id: string; message_id: string }> = [];
  for (const item of n) {
    if (item && typeof item === "object" && "thread_id" in item && "message_id" in item) {
      const t = item as { thread_id: unknown; message_id: unknown };
      if (typeof t.thread_id === "string" && typeof t.message_id === "string") {
        out.push({ thread_id: t.thread_id, message_id: t.message_id });
      }
    }
  }
  return out;
}

function serverAddrFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    if (!u.port) {
      return host;
    }
    return `${host}:${u.port}`;
  } catch {
    return urlStr;
  }
}

const appendLogLine = (
  refs: ReplRefs,
  kind: "command" | "movement" | "connection" | "diagnostic" | "conversation",
  message: string,
) =>
  Ref.update(refs.logRef, (entries) => {
    const next = { timestamp: new Date(), kind, message } as const;
    return [...entries, next].slice(-300);
  });

function isTokenRejected(e: PreFlightError): boolean {
  return e._tag === "PreFlight.TokenRejected";
}

type DispatchFailure = "NEED_RECONNECT";

const dispatchCommand = (
  refs: ReplRefs,
  svc: { readonly callTool: (typeof GhostClientService.Service)["callTool"] },
  cmd: ReplCommand,
): Effect.Effect<void, DispatchFailure | ToolError | ProtocolError, never> =>
  Effect.gen(function* () {
    switch (cmd._tag) {
      case "exit": {
        return;
      }
      case "help": {
        yield* appendLogLine(refs, "command", HELP_TEXT);
        return;
      }
      case "unknown": {
        yield* appendLogLine(refs, "diagnostic", `Unknown input${cmd.raw ? `: ${cmd.raw}` : ""}. ${HELP_TEXT}`);
        return;
      }
      case "whoami": {
        yield* appendLogLine(refs, "command", "> whoami");
        const raw = yield* svc.callTool("whoami", {});
        const id = parseGhostIdentity(raw);
        if (id) {
          yield* Ref.set(refs.identityRef, id);
        }
        yield* appendLogLine(refs, "command", id ? `ghost: ${id.ghostId}` : "whoami: (no ghost id in response)");
        return;
      }
      case "whereami": {
        yield* appendLogLine(refs, "command", "> whereami");
        const raw = yield* svc.callTool("whereami", {});
        const pos = parseGhostPosition(raw);
        if (pos) {
          yield* Ref.set(refs.positionRef, pos);
          const cs = yield* Ref.get(refs.connectionStateRef);
          if (cs._tag === "Connected") {
            yield* Ref.set(refs.connectionStateRef, {
              ...cs,
              tileId: pos.tileId,
            });
          }
        }
        yield* appendLogLine(
          refs,
          "command",
          pos ? `tile ${pos.tileId}  col ${pos.col}  row ${pos.row}` : "whereami: (unparsed)",
        );
        return;
      }
      case "look": {
        yield* appendLogLine(refs, "command", `> look ${cmd.at}`);
        const raw = yield* svc.callTool("look", { at: cmd.at });
        const tv = parseTileView(raw);
        if (tv) {
          yield* Ref.set(refs.tileViewRef, tv);
        } else {
          yield* Ref.set(refs.tileViewRef, {
            tileId: "?",
            tileClass: "?",
            occupants: [],
            prose: typeof raw === "string" ? raw : JSON.stringify(raw, null, 2),
          });
        }
        yield* appendLogLine(refs, "command", tv ? tv.prose.split("\n")[0] ?? "look ok" : "look: updated");
        return;
      }
      case "exits": {
        yield* appendLogLine(refs, "command", "> exits");
        const raw = yield* svc.callTool("exits", {});
        const ex = parseExitList(raw);
        if (ex) {
          yield* Ref.set(refs.exitsRef, ex);
        }
        yield* appendLogLine(refs, "command", ex ? `${ex.exits.length} exit(s)` : "exits: updated");
        return;
      }
      case "go": {
        yield* appendLogLine(refs, "command", `> go ${cmd.toward}`);
        const raw = yield* svc.callTool("go", { toward: cmd.toward });
        yield* appendLogLine(refs, "movement", formatGoLogMessage(raw));

        const w = yield* svc.callTool("whereami", {});
        const pos = parseGhostPosition(w);
        if (pos) {
          yield* Ref.set(refs.positionRef, pos);
          const cs = yield* Ref.get(refs.connectionStateRef);
          if (cs._tag === "Connected") {
            yield* Ref.set(refs.connectionStateRef, { ...cs, tileId: pos.tileId });
          }
        }

        const lookHere = yield* svc.callTool("look", { at: "here" });
        const tv = parseTileView(lookHere);
        if (tv) {
          yield* Ref.set(refs.tileViewRef, tv);
        }

        const exRaw = yield* svc.callTool("exits", {});
        const ex = parseExitList(exRaw);
        if (ex) {
          yield* Ref.set(refs.exitsRef, ex);
        }
        return;
      }
      case "say": {
        if (!cmd.content.trim()) {
          yield* appendLogLine(refs, "diagnostic", "say requires non-empty message text.");
          return;
        }
        yield* appendLogLine(refs, "command", `> say ${cmd.content}`);
        const said = yield* svc.callTool("say", { content: cmd.content }).pipe(Effect.either);
        if (said._tag === "Right") {
          yield* Ref.set(refs.ghostModeRef, "conversational");
          yield* appendLogLine(refs, "command", formatSayLogLine(said.right));
        } else {
          yield* appendLogLine(refs, "diagnostic", said.left.message);
        }
        return;
      }
      case "bye": {
        yield* appendLogLine(refs, "command", "> bye");
        const ended = yield* svc.callTool("bye", {}).pipe(Effect.either);
        if (ended._tag === "Right") {
          yield* Ref.set(refs.ghostModeRef, "normal");
          const prev =
            ended.right && typeof ended.right === "object" && "previous_mode" in ended.right
              ? String((ended.right as { previous_mode: unknown }).previous_mode)
              : "?";
          yield* appendLogLine(refs, "command", `bye ok — previous_mode: ${prev}`);
        } else {
          yield* appendLogLine(refs, "diagnostic", ended.left.message);
        }
        return;
      }
      default: {
        const _exhaustive: never = cmd;
        return _exhaustive;
      }
    }
  }).pipe(
    Effect.catchIf(
      (e): e is NetworkError => e instanceof NetworkError,
      () => Effect.fail("NEED_RECONNECT" as const),
    ),
    Effect.catchIf(
      (e): e is ToolError | ProtocolError => e instanceof ToolError || e instanceof ProtocolError,
      (e) => appendLogLine(refs, "diagnostic", e.message).pipe(Effect.asVoid),
    ),
  );

/**
 * Background driver: MCP session loop, reconnect with exponential backoff, command queue.
 */
export const runReplDriver = (input: {
  readonly config: GhostConfig;
  readonly refs: ReplRefs;
  readonly commandQueue: Queue.Queue<string>;
  readonly finished: Deferred.Deferred<void, never>;
}): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const { config: cfg, refs, commandQueue, finished } = input;
    const layers = Layer.mergeAll(makeGhostConfigLayer(cfg), GhostClientLayer(cfg));

    let reconnectAttempt = 0;

    while (!(yield* Deferred.isDone(finished))) {
      if (reconnectAttempt > 0) {
        const ms = Math.min(1000 * 2 ** Math.min(reconnectAttempt - 1, 15), 30_000);
        yield* Ref.set(refs.connectionStateRef, {
          _tag: "Reconnecting",
          attempt: reconnectAttempt,
          maxAttempts: 5,
          retryInMs: ms,
        });
        yield* Effect.sleep(Duration.millis(ms));
      }

      const pre = yield* runPreflight({ token: cfg.token, url: cfg.url }).pipe(Effect.either);
      if (pre._tag === "Left") {

        const err = pre.left;
        if (isTokenRejected(err)) {
          yield* appendLogLine(refs, "diagnostic", formatDiagnostic(err).message);
          yield* Ref.set(refs.connectionStateRef, { _tag: "TokenExpired" });
          yield* Deferred.succeed(finished, void 0 as void);
          return;
        }
        const d = formatDiagnostic(err);
        yield* appendLogLine(refs, "diagnostic", d.message);
        yield* Ref.set(refs.connectionStateRef, { _tag: "Disconnected", reason: d.message });
        reconnectAttempt += 1;
        if (reconnectAttempt >= 5) {
          yield* appendLogLine(
            refs,
            "diagnostic",
            "Reconnect attempts exhausted after 5 tries — fix connectivity or credentials, then restart ghost-cli.",
          );
          yield* Deferred.succeed(finished, void 0 as void);
          return;
        }
        continue;
      }

      reconnectAttempt = 0;
      const identity = pre.right;
      yield* Ref.set(refs.identityRef, identity);

      const sessionResult = yield* Effect.scoped(
        Effect.gen(function* () {
          const svc = yield* GhostClientService;

          const serverAddr = serverAddrFromUrl(cfg.url.trim());

          // Fetch initial state — fail-soft so an unplaced ghost still enters the command loop.
          const whereResult = yield* svc.callTool("whereami", {}).pipe(Effect.either);
          const pos = whereResult._tag === "Right" ? parseGhostPosition(whereResult.right) : null;
          if (pos) {
            yield* Ref.set(refs.positionRef, pos);
          }

          yield* Ref.set(refs.connectionStateRef, {
            _tag: "Connected",
            ghostId: identity.ghostId,
            tileId: pos?.tileId ?? "—",
            serverAddr,
          });

          if (whereResult._tag === "Left") {
            yield* appendLogLine(refs, "diagnostic", `whereami: ${whereResult.left.message}`);
          }

          const lookResult = yield* svc.callTool("look", { at: "here" }).pipe(Effect.either);
          if (lookResult._tag === "Right") {
            const tv = parseTileView(lookResult.right);
            if (tv) {
              yield* Ref.set(refs.tileViewRef, tv);
            }
          }

          const exitsResult = yield* svc.callTool("exits", {}).pipe(Effect.either);
          if (exitsResult._tag === "Right") {
            const ex = parseExitList(exitsResult.right);
            if (ex) {
              yield* Ref.set(refs.exitsRef, ex);
            }
          }

          yield* appendLogLine(refs, "connection", `connected as ${identity.ghostId}`);

          yield* Effect.forkScoped(
            Effect.gen(function* () {
              while (!(yield* Deferred.isDone(finished))) {
                yield* Effect.sleep(Duration.seconds(3));
                if (yield* Deferred.isDone(finished)) break;
                const res = yield* svc.callTool("inbox", {}).pipe(Effect.either);
                if (res._tag === "Left") continue;
                for (const n of notificationsFromInbox(res.right)) {
                  yield* appendLogLine(
                    refs,
                    "conversation",
                    `message.new thread_id=${n.thread_id} message_id=${n.message_id}`,
                  );
                }
              }
            }),
          );

          while (!(yield* Deferred.isDone(finished))) {
            const line = yield* Queue.take(commandQueue);
            if (line === "__EXIT__") {
              yield* Deferred.succeed(finished, void 0 as void);
              return "exit" as const;
            }

            const cmd = parseReplCommand(line);
            if (cmd._tag === "exit") {
              yield* appendLogLine(refs, "connection", "goodbye");
              yield* Deferred.succeed(finished, void 0 as void);
              return "exit" as const;
            }

            const ran = yield* dispatchCommand(refs, svc, cmd).pipe(Effect.either);

            if (ran._tag === "Left" && ran.left === "NEED_RECONNECT") {
              yield* appendLogLine(refs, "connection", "lost connection — reconnecting…");
              return "reconnect" as const;
            }
          }
          return "exit" as const;
        }).pipe(Effect.provide(layers)),
      ).pipe(
        Effect.catchIf(
          (e): e is NetworkError => e instanceof NetworkError,
          () =>
            Effect.gen(function* () {
              yield* appendLogLine(refs, "connection", "lost connection — reconnecting…");
              return "reconnect" as const;
            }),
        ),
        Effect.catchIf(
          (e): e is ProtocolError => e instanceof ProtocolError,
          (e) =>
            Effect.gen(function* () {
              yield* appendLogLine(refs, "diagnostic", `protocol error: ${e.message}`);
              yield* Ref.set(refs.connectionStateRef, {
                _tag: "Disconnected",
                reason: "MCP protocol error — see log; check server logs if this persists.",
              });
              yield* Deferred.succeed(finished, void 0 as void);
              return "exit" as const;
            }),
        ),
        Effect.catchIf(
          (e): e is ToolError => e instanceof ToolError,
          (e) =>
            Effect.gen(function* () {
              yield* appendLogLine(refs, "diagnostic", `session error: ${e.message}`);
              yield* Ref.set(refs.connectionStateRef, {
                _tag: "Disconnected",
                reason: "Could not complete MCP session setup.",
              });
              yield* Deferred.succeed(finished, void 0 as void);
              return "exit" as const;
            }),
        ),
      );

      if (sessionResult === "exit") {
        return;
      }

      reconnectAttempt += 1;
      if (reconnectAttempt >= 5) {
        yield* appendLogLine(
          refs,
          "connection",
          "Reconnect attempts exhausted — fix connectivity or credentials, then restart ghost-cli.",
        );
        yield* Ref.set(refs.connectionStateRef, { _tag: "Disconnected", reason: "Reconnect attempts exhausted (5)." });
        yield* Deferred.succeed(finished, void 0 as void);
        return;
      }
    }
  });
