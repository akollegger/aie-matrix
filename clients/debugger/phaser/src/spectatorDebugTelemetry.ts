import { Effect, Layer, Logger } from "effect";

const MAX_LINES = 100;

/** In-memory tail used by the Log tab. */
export class SpectatorDebugLogRing {
  private readonly lines: string[] = [];
  private readonly listeners = new Set<() => void>();

  append(line: string): void {
    const text = line.replace(/\r?\n/g, " ").replace(/\s+$/, "");
    if (text.length === 0) {
      return;
    }
    this.lines.push(text);
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
    }
    for (const fn of this.listeners) {
      fn();
    }
  }

  snapshot(): readonly string[] {
    return [...this.lines];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

function stringifyArg(a: unknown): string {
  if (typeof a === "string") {
    return a;
  }
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/**
 * Forwards browser `console.*` into the ring buffer (in addition to the real console).
 * Effect's default logger in the browser also ends up on the console, so those lines
 * appear here without wiring every call site through Effect.
 */
export function installSpectatorDebugConsoleForward(ring: SpectatorDebugLogRing): () => void {
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  type Level = (typeof levels)[number];
  const c = console as unknown as Record<Level, (...args: unknown[]) => void>;
  const originals = {} as Record<Level, (...args: unknown[]) => void>;
  for (const level of levels) {
    const orig = c[level].bind(console) as (...args: unknown[]) => void;
    originals[level] = orig;
    c[level] = (...args: unknown[]) => {
      orig(...args);
      ring.append(`[console.${level}] ${args.map(stringifyArg).join(" ")}`);
    };
  }
  return () => {
    for (const level of levels) {
      c[level] = originals[level];
    }
  };
}

/**
 * Replaces the default logger with `Logger.zipLeft(console, panel)`:
 * leveled console output (same idea as "stdout" in Node) plus one line per log in the ring buffer.
 *
 * Use with `Effect.provide(...)` around Effect programs on the client. The Phaser bootstrap is
 * not Effect-based; pair this with {@link installSpectatorDebugConsoleForward} for full coverage.
 *
 * @see https://effect.website/docs/observability/logging/#combine-loggers
 */
export function spectatorDebugZippedLoggerLayer(ring: SpectatorDebugLogRing): Layer.Layer<never> {
  const panelLogger = Logger.map(Logger.stringLogger, (line: string): void => {
    ring.append(line);
  });
  const consoleAndPanel = Logger.zipLeft(Logger.withLeveledConsole(Logger.stringLogger), panelLogger);
  return Logger.replace(Logger.defaultLogger, consoleAndPanel);
}

/** One-shot so the Log tab shows an Effect-routed line using the same ring as the HTML overlay. */
export function runSpectatorDebugEffectProbe(ring: SpectatorDebugLogRing): void {
  void Effect.runPromise(
    Effect.log("spectator debug: Effect logger active (Logger.zipLeft → console + panel)").pipe(
      Effect.provide(spectatorDebugZippedLoggerLayer(ring)),
    ),
  );
}
