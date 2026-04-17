export type Face = "n" | "s" | "ne" | "nw" | "se" | "sw";

export type ReplCommand =
  | { readonly _tag: "whoami" }
  | { readonly _tag: "whereami" }
  | { readonly _tag: "look"; readonly at: "here" | "around" | Face }
  | { readonly _tag: "exits" }
  | { readonly _tag: "go"; readonly toward: Face }
  | { readonly _tag: "help" }
  | { readonly _tag: "exit" }
  | { readonly _tag: "unknown"; readonly raw: string };

const FACES = new Set<string>(["n", "s", "ne", "nw", "se", "sw"]);

function isFace(s: string): s is Face {
  return FACES.has(s);
}

/** Pure REPL line parser (data-model.md). */
export function parseReplCommand(input: string): ReplCommand {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { _tag: "unknown", raw: "" };
  }
  const lower = trimmed.toLowerCase();
  const parts = lower.split(/\s+/).filter((p) => p.length > 0);

  if (parts[0] === "exit" || parts[0] === "quit") {
    return { _tag: "exit" };
  }
  if (parts[0] === "help" || parts[0] === "?") {
    return { _tag: "help" };
  }
  if (parts[0] === "whoami") {
    return { _tag: "whoami" };
  }
  if (parts[0] === "whereami") {
    return { _tag: "whereami" };
  }
  if (parts[0] === "exits") {
    return { _tag: "exits" };
  }

  if (parts[0] === "look") {
    const rest = parts[1];
    if (!rest || rest === "here") {
      return { _tag: "look", at: "here" };
    }
    if (rest === "around") {
      return { _tag: "look", at: "around" };
    }
    if (isFace(rest)) {
      return { _tag: "look", at: rest };
    }
    return { _tag: "unknown", raw: trimmed };
  }

  if (parts[0] === "go") {
    const rest = parts[1];
    if (rest && isFace(rest)) {
      return { _tag: "go", toward: rest };
    }
    return { _tag: "unknown", raw: trimmed };
  }

  return { _tag: "unknown", raw: trimmed };
}
