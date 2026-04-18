import { Box, Text } from "ink";
import type { ExitList } from "./repl-state.js";

export interface ExitsPanelProps {
  readonly exits: ExitList | null;
}

export const ExitsPanel = ({ exits }: ExitsPanelProps) => (
  <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} flexGrow={1}>
    <Text bold color="green">
      EXITS
    </Text>
    {exits === null || exits.exits.length === 0 ? (
      <Text>none</Text>
    ) : (
      exits.exits.map((e) => (
        <Text key={`${e.toward}-${e.tileId}`}>
          {e.toward} → {e.tileId}
        </Text>
      ))
    )}
  </Box>
);
