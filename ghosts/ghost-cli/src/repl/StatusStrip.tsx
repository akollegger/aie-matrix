import { Box, Text } from "ink";
import type { ConnectionState } from "./repl-state.js";

export interface StatusStripProps {
  readonly state: ConnectionState;
  /** When true, ghost is in conversational mode (MCP `say` active until `bye`). */
  readonly conversational?: boolean;
}

export const StatusStrip = ({ state, conversational }: StatusStripProps) => {
  switch (state._tag) {
    case "Connected": {
      return (
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Text color="green" bold>
            ● CONNECTED
          </Text>
          {conversational ? (
            <Text color="magenta" bold>
              [conversational]
            </Text>
          ) : null}
          <Text>
            ghost: {state.ghostId} tile: {state.tileId} server: {state.serverAddr}
          </Text>
        </Box>
      );
    }
    case "Reconnecting": {
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="yellow" bold>
            ◌ RECONNECTING
          </Text>
          <Text>
            attempt {state.attempt}/{state.maxAttempts} — retry in {Math.ceil(state.retryInMs / 1000)}s
          </Text>
        </Box>
      );
    }
    case "Disconnected": {
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="red" bold>
            ✗ DISCONNECTED
          </Text>
          <Text>{state.reason ?? "not connected"}</Text>
        </Box>
      );
    }
    case "TokenExpired": {
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="red" bold>
            ⚠ TOKEN EXPIRED
          </Text>
          <Text>re-adopt to continue: pnpm run ghost:register</Text>
        </Box>
      );
    }
    default: {
      const _x: never = state;
      return <Text>{String(_x)}</Text>;
    }
  }
};
