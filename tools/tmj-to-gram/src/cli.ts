import * as Args from "@effect/cli/Args";
import * as Command from "@effect/cli/Command";
import * as Options from "@effect/cli/Options";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { ConfigProvider, Effect, Layer, Option } from "effect";

import { convertTmjToGram } from "./convert.js";

const tmjPathArg = Args.repeated(Args.text({ name: "tmj-path" }));
const outOption = Options.optional(Options.text("out"));

const convertCmd = Command.make(
  "convert",
  { tmj: tmjPathArg, out: outOption },
  ({ tmj, out }) =>
    Effect.gen(function* () {
      if (tmj.length === 0) {
        console.error("[error] At least one tmj-path argument is required");
        yield* Effect.sync(() => process.exit(1));
        return;
      }
      if (tmj.length > 1 && Option.isSome(out)) {
        console.error("[error] --out cannot be used with multiple input files");
        yield* Effect.sync(() => process.exit(1));
        return;
      }
      let worstCode = 0;
      for (const tmjPath of tmj) {
        const code = yield* Effect.promise(() =>
          convertTmjToGram({
            tmjPath,
            outPath: tmj.length === 1 ? Option.getOrUndefined(out) : undefined,
            logError: (m) => { console.error(m); },
            logWarn: (m) => { console.error(m); },
          }),
        );
        if (code !== 0) worstCode = code;
      }
      yield* Effect.sync(() => process.exit(worstCode));
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
