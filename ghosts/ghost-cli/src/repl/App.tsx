import { Deferred, Effect, Queue } from "effect";
import { Box, useApp } from "ink";
import { useEffect } from "react";

import { ExitsPanel } from "./ExitsPanel.js";
import { GhostPanel } from "./GhostPanel.js";
import { usePollRef } from "./hooks.js";
import { InputBar } from "./InputBar.js";
import { LogPanel } from "./LogPanel.js";
import type { ConnectionState, ReplRefs } from "./repl-state.js";
import { StatusStrip } from "./StatusStrip.js";
import { WorldView } from "./WorldView.js";

export interface AppProps {
  readonly refs: ReplRefs;
  readonly commandQueue: Queue.Queue<string>;
  readonly finished: Deferred.Deferred<void, never>;
}

export const App = ({ refs, commandQueue, finished }: AppProps) => {
  const { exit } = useApp();

  const connection = usePollRef(refs.connectionStateRef);
  const identity = usePollRef(refs.identityRef);
  const position = usePollRef(refs.positionRef);
  const tileView = usePollRef(refs.tileViewRef);
  const exits = usePollRef(refs.exitsRef);
  const logEntries = usePollRef(refs.logRef);

  useEffect(() => {
    const id = setInterval(() => {
      void Effect.runPromise(Deferred.isDone(finished)).then((done) => {
        if (done) {
          exit();
        }
      });
    }, 150);
    return () => clearInterval(id);
  }, [exit, finished]);

  const inputState = inputBarState(connection);

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <StatusStrip state={connection} />
      <Box flexDirection="row" gap={1} alignItems="stretch">
        <Box width="55%">
          <WorldView tileView={tileView} />
        </Box>
        <Box width="45%" flexDirection="column" gap={1}>
          <GhostPanel identity={identity} position={position} />
          <ExitsPanel exits={exits} />
        </Box>
      </Box>
      <LogPanel entries={[...logEntries]} />
      <InputBar
        interactive={inputState.interactive}
        statusNote={inputState.note}
        onSubmitLine={(line) => {
          void Effect.runPromise(Queue.offer(commandQueue, line));
        }}
      />
    </Box>
  );
};

function inputBarState(conn: ConnectionState): { interactive: boolean; note?: string } {
  if (conn._tag === "TokenExpired") {
    return { interactive: false, note: "Token expired — run `pnpm run ghost:register` for a fresh token" };
  }
  if (conn._tag === "Reconnecting") {
    return { interactive: true, note: "(reconnecting…)" };
  }
  return { interactive: true };
}
