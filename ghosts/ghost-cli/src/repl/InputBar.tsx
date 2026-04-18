import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";

export interface InputBarProps {
  /** When false, input is for display only (token expired). */
  readonly interactive: boolean;
  readonly statusNote?: string;
  readonly onSubmitLine: (line: string) => void;
}

export const InputBar = ({ interactive, statusNote, onSubmitLine }: InputBarProps) => {
  const [value, setValue] = useState("");

  if (!interactive) {
    return (
      <Box flexDirection="row">
        <Text dimColor>{statusNote ?? "Input disabled."}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {statusNote !== undefined ? (
        <Text dimColor>{statusNote}</Text>
      ) : null}
      <Box flexDirection="row">
        <Text>{"> "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(line) => {
            onSubmitLine(line);
            setValue("");
          }}
        />
      </Box>
    </Box>
  );
};
