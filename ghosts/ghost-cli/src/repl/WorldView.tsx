import { Box, Text } from "ink";
import type { TileView } from "./repl-state.js";

export interface WorldViewProps {
  readonly tileView: TileView | null;
}

export const WorldView = ({ tileView }: WorldViewProps) => (
  <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
    <Text bold color="cyan">
      WORLD VIEW
    </Text>
    {tileView === null ? (
      <Text dimColor>looking…</Text>
    ) : (
      <Text>{tileView.prose}</Text>
    )}
  </Box>
);
