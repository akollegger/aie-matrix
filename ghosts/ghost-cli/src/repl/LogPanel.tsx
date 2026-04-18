import { Box, Text } from "ink";
import { useStdout } from "ink";
import type { LogEntry } from "./repl-state.js";

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

export interface LogPanelProps {
  readonly entries: readonly LogEntry[];
}

export const LogPanel = ({ entries }: LogPanelProps) => {
  const { stdout } = useStdout();
  const maxRows = Math.max(4, Math.min(12, (stdout.rows ?? 24) - 14));

  const windowed = entries.slice(-maxRows);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>LOG</Text>
      {windowed.map((e, i) => (
        <Text key={`${e.timestamp.getTime()}-${i}`}>
          [{formatTime(e.timestamp)}] {e.message}
        </Text>
      ))}
    </Box>
  );
};
