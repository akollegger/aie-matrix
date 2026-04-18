import { openSync } from "node:fs";
import { ReadStream } from "node:tty";
import { render } from "ink";
import { Deferred, Effect, Queue } from "effect";
import React from "react";

import type { GhostConfig } from "../config.js";
import { App } from "./App.js";
import { createReplRefs } from "./repl-state.js";
import { runReplDriver } from "./session.js";

/**
 * Starts the Ink REPL and blocks until the UI exits (user `exit`, Ctrl+C, or session end).
 *
 * When spawned through a subprocess chain (e.g. pnpm --filter), process.stdin.isTTY
 * may be false even though a real terminal is connected. We open /dev/tty directly so
 * Ink can enable raw mode for interactive input — the same approach used by vim, fzf, etc.
 */
export async function startInteractiveRepl(config: GhostConfig): Promise<void> {
  let inkStdin: NodeJS.ReadStream = process.stdin;
  let ttyStream: ReadStream | undefined;

  if (!process.stdin.isTTY) {
    try {
      const fd = openSync("/dev/tty", "r+");
      ttyStream = new ReadStream(fd);
      inkStdin = ttyStream as unknown as NodeJS.ReadStream;
    } catch {
      /* Ink falls back to non-interactive stdin; input may be limited */
    }
  }

  const refs = await Effect.runPromise(createReplRefs);
  const commandQueue = await Effect.runPromise(Queue.unbounded<string>());
  const finished = await Effect.runPromise(Deferred.make<void, never>());

  const driverPromise = Effect.runPromise(runReplDriver({ config, refs, commandQueue, finished }));

  const { waitUntilExit } = render(
    React.createElement(App, { refs, commandQueue, finished }),
    { exitOnCtrlC: true, stdin: inkStdin, stdout: process.stdout },
  );

  await waitUntilExit();
  if (ttyStream) {
    ttyStream.destroy();
  }
  await Effect.runPromise(Queue.offer(commandQueue, "__EXIT__"));
  await driverPromise;
}
