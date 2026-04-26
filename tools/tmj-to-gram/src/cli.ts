import * as Args from "@effect/cli/Args";
import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, Option } from "effect";

import { convertTmjToGram } from "./convert.js";

const tmjPathArg = Args.text({ name: "tmj-path" });
const outOption = Options.optional(Options.text("out"));

const convertCmd = Command.make(
  "convert",
  { tmj: tmjPathArg, out: outOption },
  ({ tmj, out }) =>
    Effect.gen(function* () {
      const code = yield* Effect.promise(() =>
        convertTmjToGram({
          tmjPath: tmj,
          outPath: Option.getOrUndefined(out),
          logError: (m) => {
            console.error(m);
          },
          logWarn: (m) => {
            console.error(m);
          },
        }),
      );
      yield* Effect.sync(() => process.exit(code));
    }),
);

const root = Command.make("tmj-to-gram", {}, () => Effect.void).pipe(Command.withSubcommands([convertCmd]));

export const cli = Command.run(root, {
  name: "tmj-to-gram",
  version: "0.0.0",
});

const platform = Layer.mergeAll(NodeContext.layer, Layer.setConfigProvider(ConfigProvider.fromEnv()));

export const runMain = (): void => {
  cli(process.argv).pipe(Effect.provide(platform), (e) => NodeRuntime.runMain(e, { disableErrorReporting: true }));
};
