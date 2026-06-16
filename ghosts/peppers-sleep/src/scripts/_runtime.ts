import { pathToFileURL } from "node:url";

/**
 * True when this module file is the process's CLI entrypoint (i.e. run
 * directly via `node`/`tsx`), false when it's merely imported. Lets each
 * sleep step export its body as a callable function for the in-process
 * blackout pipeline AND keep its `pnpm run <step>` CLI for the lab —
 * without the CLI body executing on import.
 */
export function isCliEntry(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return metaUrl === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}
