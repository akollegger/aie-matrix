import { Box, Text } from "ink";
import type { GhostIdentity, GhostPosition } from "./repl-state.js";

export interface GhostPanelProps {
  readonly identity: GhostIdentity | null;
  readonly position: GhostPosition | null;
}

export const GhostPanel = ({ identity, position }: GhostPanelProps) => (
  <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} minHeight={6}>
    <Text bold color="magenta">
      GHOST
    </Text>
    <Text>id: {identity?.ghostId ?? "—"}</Text>
    <Text>tile: {position?.tileId ?? "—"}</Text>
    <Text>
      col: {position !== null ? String(position.col) : "—"} row: {position !== null ? String(position.row) : "—"}
    </Text>
  </Box>
);
