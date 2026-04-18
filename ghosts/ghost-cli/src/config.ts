import * as Options from "@effect/cli/Options";
import { Config, Context, Layer } from "effect";

/**
 * Resolved CLI configuration (flags → env → `.env` via {@link loadRootEnv} before startup).
 */
export interface GhostConfig {
  readonly token: string;
  readonly url: string;
  readonly debug: boolean;
  readonly json: boolean;
}

export class GhostConfigLive extends Context.Tag("@aie-matrix/ghost-cli/GhostConfig")<
  GhostConfigLive,
  GhostConfig
>() {}

export const makeGhostConfigLayer = (config: GhostConfig): Layer.Layer<GhostConfigLive> =>
  Layer.succeed(GhostConfigLive, config);

export const tokenOption = Options.text("token").pipe(
  Options.withAlias("t"),
  Options.withFallbackConfig(Config.string("GHOST_TOKEN").pipe(Config.withDefault(""))),
);

export const urlOption = Options.text("url").pipe(
  Options.withAlias("u"),
  Options.withFallbackConfig(Config.string("WORLD_API_URL").pipe(Config.withDefault(""))),
);

export const debugOption = Options.boolean("debug", { ifPresent: true }).pipe(Options.withDefault(false));

export const jsonOption = Options.boolean("json", { ifPresent: true }).pipe(Options.withDefault(false));

/** Root command only — enter the Ink REPL when set, or when no subcommand is given on a TTY. */
export const interactiveOption = Options.boolean("interactive", { ifPresent: true }).pipe(
  Options.withAlias("i"),
  Options.withDefault(false),
);
