import { Effect, Ref } from "effect";

/** Hex face tokens (IC-003 local frame). */
export type Face = "n" | "s" | "ne" | "nw" | "se" | "sw";

const FACES = new Set<string>(["n", "s", "ne", "nw", "se", "sw"]);

export function isFace(s: string): s is Face {
  return FACES.has(s);
}

/** Drives the status strip (data-model.md). */
export type ConnectionState =
  | { readonly _tag: "Connected"; readonly ghostId: string; readonly tileId: string; readonly serverAddr: string }
  | {
      readonly _tag: "Reconnecting";
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly retryInMs: number;
    }
  | { readonly _tag: "Disconnected"; readonly reason?: string }
  | { readonly _tag: "TokenExpired" };

export interface GhostIdentity {
  readonly ghostId: string;
  readonly displayName?: string;
}

export interface GhostPosition {
  readonly tileId: string;
  readonly col: number;
  readonly row: number;
}

export interface TileView {
  readonly tileId: string;
  readonly tileClass: string;
  readonly occupants: string[];
  readonly prose: string;
}

export interface ExitList {
  readonly exits: ReadonlyArray<{ readonly toward: string; readonly tileId: string }>;
}

export type LogEntry = {
  readonly timestamp: Date;
  readonly kind: "command" | "movement" | "connection" | "diagnostic" | "conversation";
  readonly message: string;
};

export type ReplCommand =
  | { readonly _tag: "whoami" }
  | { readonly _tag: "whereami" }
  | { readonly _tag: "look"; readonly at: "here" | "around" | Face }
  | { readonly _tag: "exits" }
  | { readonly _tag: "go"; readonly toward: Face }
  | { readonly _tag: "say"; readonly content: string }
  | { readonly _tag: "bye" }
  | { readonly _tag: "help" }
  | { readonly _tag: "exit" }
  | { readonly _tag: "unknown"; readonly raw: string };

export type GhostConversationMode = "normal" | "conversational";

export interface ReplRefs {
  readonly connectionStateRef: Ref.Ref<ConnectionState>;
  readonly identityRef: Ref.Ref<GhostIdentity | null>;
  readonly positionRef: Ref.Ref<GhostPosition | null>;
  readonly tileViewRef: Ref.Ref<TileView | null>;
  readonly exitsRef: Ref.Ref<ExitList | null>;
  readonly logRef: Ref.Ref<readonly LogEntry[]>;
  /** Mirrors server conversational state for UI (say/bye + inbox). */
  readonly ghostModeRef: Ref.Ref<GhostConversationMode>;
}

export const parseReplCommand = (input: string): ReplCommand => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { _tag: "unknown", raw: "" };
  }
  const lower = trimmed.toLowerCase();
  const parts = lower.split(/\s+/).filter((p) => p.length > 0);

  const head = parts[0];
  if (!head) {
    return { _tag: "unknown", raw: "" };
  }

  if (head === "whoami" && parts.length === 1) {
    return { _tag: "whoami" };
  }
  if (head === "whereami" && parts.length === 1) {
    return { _tag: "whereami" };
  }
  if (head === "exits" && parts.length === 1) {
    return { _tag: "exits" };
  }
  if (head === "bye" && parts.length === 1) {
    return { _tag: "bye" };
  }
  if (head === "say") {
    const m = trimmed.match(/^say\s+(.*)$/i);
    if (m) {
      return { _tag: "say", content: m[1] ?? "" };
    }
    return { _tag: "unknown", raw: trimmed };
  }
  if (head === "help" && parts.length === 1) {
    return { _tag: "help" };
  }
  if ((head === "exit" || head === "quit") && parts.length === 1) {
    return { _tag: "exit" };
  }

  if (head === "look") {
    if (parts.length === 1) {
      return { _tag: "look", at: "here" };
    }
    const at = parts[1]!;
    if (at === "here") {
      return { _tag: "look", at: "here" };
    }
    if (at === "around") {
      return { _tag: "look", at: "around" };
    }
    if (isFace(at)) {
      return { _tag: "look", at };
    }
    return { _tag: "unknown", raw: trimmed };
  }

  if (head === "go") {
    if (parts.length < 2) {
      return { _tag: "unknown", raw: trimmed };
    }
    const toward = parts[1]!;
    if (isFace(toward)) {
      return { _tag: "go", toward };
    }
    return { _tag: "unknown", raw: trimmed };
  }

  return { _tag: "unknown", raw: trimmed };
};

/** Creates all REPL panel refs with initial empty / disconnected state. */
export const createReplRefs: Effect.Effect<ReplRefs, never, never> = Effect.gen(function* () {
  const connectionStateRef = yield* Ref.make<ConnectionState>({ _tag: "Disconnected" });
  const identityRef = yield* Ref.make<GhostIdentity | null>(null);
  const positionRef = yield* Ref.make<GhostPosition | null>(null);
  const tileViewRef = yield* Ref.make<TileView | null>(null);
  const exitsRef = yield* Ref.make<ExitList | null>(null);
  const logRef = yield* Ref.make<readonly LogEntry[]>([]);
  const ghostModeRef = yield* Ref.make<GhostConversationMode>("normal");

  return {
    connectionStateRef,
    identityRef,
    positionRef,
    tileViewRef,
    exitsRef,
    logRef,
    ghostModeRef,
  };
});
