import { Box, Text } from "ink";
import type { ConnectionState } from "./repl-state.js";

export interface StatusStripProps {
  readonly state: ConnectionState;
}

export const StatusStrip = ({ state }: StatusStripProps) => {
  switch (state._tag) {
    case "Connected": {
      return (
        <Box flexDirection="row" gap={2}>
          <Text color="green" bold>
            ● CONNECTED
          </Text>
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
