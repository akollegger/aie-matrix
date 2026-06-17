export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLevel(raw: string | undefined): LogLevel {
  const v = raw?.toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return v;
  return "info";
}

export interface LogFields {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields & { readonly error?: unknown }): void;
  /** Returns a new logger that prefixes every `kind` with `${prefix}.` */
  child(prefix: string): Logger;
}

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err == null) return undefined;
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { raw: String(err) };
}

function makeLogger(minLevel: LogLevel, kindPrefix: string): Logger {
  const min = LEVELS[minLevel];

  function emit(
    level: LogLevel,
    fields: LogFields & { error?: unknown },
  ): void {
    if (LEVELS[level] < min) return;
    const { error: rawError, ...rest } = fields;
    const entry: Record<string, unknown> = {
      level,
      ...rest,
      kind: kindPrefix ? `${kindPrefix}.${rest.kind}` : rest.kind,
      ts: new Date().toISOString(),
    };
    if (rawError !== undefined) entry["error"] = serializeError(rawError);
    const line = JSON.stringify(entry);
    if (level === "warn" || level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }

  return {
    debug: (f) => emit("debug", f),
    info: (f) => emit("info", f),
    warn: (f) => emit("warn", f),
    error: (f) => emit("error", f),
    child: (prefix) =>
      makeLogger(minLevel, kindPrefix ? `${kindPrefix}.${prefix}` : prefix),
  };
}

/**
 * Process-wide logger. Reads LOG_LEVEL from env at import time.
 * Override with LOG_LEVEL=debug|info|warn|error.
 */
export const logger: Logger = makeLogger(
  parseLevel(process.env["LOG_LEVEL"]),
  "",
);

/** Create a logger whose kind fields are automatically prefixed. */
export function createLogger(prefix: string): Logger {
  return logger.child(prefix);
}
