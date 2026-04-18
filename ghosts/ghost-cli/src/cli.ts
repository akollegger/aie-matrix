import * as Args from "@effect/cli/Args";
import * as Command from "@effect/cli/Command";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { ConfigProvider, Console, Effect, Layer, pipe } from "effect";

import {
  GhostConfigLive,
  debugOption,
  interactiveOption,
  jsonOption,
  makeGhostConfigLayer,
  tokenOption,
  urlOption,
  type GhostConfig,
} from "./config.js";
import { formatDiagnostic, toExitCode } from "./diagnostics.js";
import { runExits, runGo, runLook, runWhereami, runWhoami } from "./oneshot/commands.js";
import { CliSilentExit, CliUsageError } from "./oneshot/errors.js";
import type { PreFlightError } from "./preflight/errors.js";
import {
  GhostClientLayer,
  GhostClientService,
  NetworkError,
  ProtocolError,
  ToolError,
} from "./services/GhostClientService.js";
import { startInteractiveRepl } from "./repl/start-interactive.js";

const globals = {
  token: tokenOption,
  url: urlOption,
  debug: debugOption,
  json: jsonOption,
};

const rootOnly = {
  ...globals,
  interactive: interactiveOption,
};

const toConfig = (p: { token: string; url: string; debug: boolean; json: boolean }): GhostConfig => ({
  token: p.token.trim(),
  url: p.url.trim(),
  debug: p.debug,
  json: p.json,
});

function isPreFlightError(e: unknown): e is PreFlightError {
  return typeof e === "object" && e !== null && "_tag" in e && String((e as { _tag: string })._tag).startsWith("PreFlight.");
}

function isGhostClientErr(e: unknown): e is NetworkError | ProtocolError | ToolError {
  return e instanceof NetworkError || e instanceof ProtocolError || e instanceof ToolError;
}

function isOneshotCliErr(e: unknown): e is CliUsageError | CliSilentExit {
  return e instanceof CliUsageError || e instanceof CliSilentExit;
}

const reportPreFlight = (e: PreFlightError) =>
  Effect.gen(function* () {
    const d = formatDiagnostic(e);
    yield* Console.error(d.message);
    if (d.remedy) {
      yield* Console.error(d.remedy);
    }
    yield* Effect.sync(() => process.exit(toExitCode(e)));
  });

const reportGhostClient = (e: NetworkError | ProtocolError | ToolError) =>
  Effect.gen(function* () {
    yield* Console.error(e.message);
    yield* Effect.sync(() => process.exit(1));
  });

const reportOneshotCli = (e: CliUsageError | CliSilentExit) =>
  Effect.gen(function* () {
    if (e instanceof CliUsageError) {
      yield* Console.error(e.message);
    }
    yield* Effect.sync(() => process.exit(e instanceof CliSilentExit ? e.exitCode : 1));
  });

const wrapOneshot = (
  p: { token: string; url: string; debug: boolean; json: boolean },
  run: (c: GhostConfig) => Effect.Effect<
    void,
    PreFlightError | NetworkError | ProtocolError | ToolError | CliUsageError | CliSilentExit,
    GhostConfigLive | GhostClientService
  >,
) => {
  const cfg = toConfig(p);
  const layers = Layer.mergeAll(makeGhostConfigLayer(cfg), GhostClientLayer(cfg));
  return pipe(
    Effect.scoped(
      Effect.gen(function* () {
        yield* pipe(
          run(cfg),
          Effect.catchIf(isPreFlightError, reportPreFlight),
          Effect.catchIf(isGhostClientErr, reportGhostClient),
          Effect.catchIf(isOneshotCliErr, reportOneshotCli),
        );
      }).pipe(Effect.provide(layers)),
    ),
    Effect.catchIf(isGhostClientErr, reportGhostClient),
  );
};

const whoamiCmd = Command.make("whoami", { ...globals }, (p) => wrapOneshot(p, runWhoami));

const whereamiCmd = Command.make("whereami", { ...globals }, (p) => wrapOneshot(p, runWhereami));

const lookAt = Args.text({ name: "at" }).pipe(Args.withDefault("here"));
const lookCmd = Command.make("look", { ...globals, at: lookAt }, (p) => wrapOneshot(p, (c) => runLook(c, p.at)));

const exitsCmd = Command.make("exits", { ...globals }, (p) => wrapOneshot(p, runExits));

const towardArg = Args.text({ name: "toward" });
const goCmd = Command.make("go", { ...globals, toward: towardArg }, (p) => wrapOneshot(p, (c) => runGo(c, p.toward)));

const root = Command.make(
  "ghost-cli",
  rootOnly,
  (p) =>
    Effect.gen(function* () {
      const cfg = toConfig(p);

      if (p.interactive && !process.stdout.isTTY) {
        yield* Console.error(
          "ghost-cli: --interactive requires a terminal (TTY). Example one-shot: `ghost-cli whoami`.",
        );
        yield* Effect.sync(() => process.exit(1));
        return;
      }

      // FR-016 / RFC Q4: non-TTY defaults to plain-text one-shot `whoami` instead of Ink.
      if (!process.stdout.isTTY) {
        yield* wrapOneshot(p, runWhoami);
        return;
      }

      // Machine-readable output should not launch the REPL on a TTY.
      if (cfg.json) {
        yield* wrapOneshot(p, runWhoami);
        return;
      }

      yield* Effect.async<void>((resume) => {
        void startInteractiveRepl(cfg)
          .then(() => {
            process.exit(0);
            resume(Effect.void);
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`ghost-cli: ${msg}`);
            process.exit(1);
            resume(Effect.void);
          });
      });
    }),
).pipe(Command.withSubcommands([whoamiCmd, whereamiCmd, lookCmd, exitsCmd, goCmd]));

export const cli = Command.run(root, {
  name: "ghost-cli",
  version: "0.0.0",
});

const platform = Layer.mergeAll(NodeContext.layer, Layer.setConfigProvider(ConfigProvider.fromEnv()));

export const runMain = (): void => {
  cli(process.argv).pipe(Effect.provide(platform), (e) => NodeRuntime.runMain(e, { disableErrorReporting: true }));
};
