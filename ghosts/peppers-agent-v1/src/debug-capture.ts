/**
 * Structured debug capture for peppers cascades.
 *
 * Enabled by setting `PEPPERS_CAPTURE_LOG=<path>`. When set, every
 * cascade, decommission, and architectural-rule-firing event is
 * appended as a single JSON line to the configured file. The
 * resulting JSONL is post-hoc queryable with grep / jq.
 *
 * Why this exists: the spectator (human) cannot easily verify
 * properties like "no PokerTable references appear in any monologue"
 * or "decommission fires within N cascades" without scrolling 6
 * ghosts' worth of terminal output. The capture file makes those
 * checks mechanical — `grep -ci pokertable` answers the first;
 * `grep '"kind":"decommissioned"'` answers the second. The agent
 * authoring the system reads the file directly and reports back,
 * rather than the human acting as a parser.
 *
 * Performance: writes are synchronous (`fs.appendFileSync`) so a
 * crash never loses the last cascade's record. One write per
 * cascade — negligible alongside the LLM-bound runtime.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/** Absolute path to the capture file, or null when capture is off. */
const CAPTURE_PATH: string | null = (() => {
  const raw = process.env.PEPPERS_CAPTURE_LOG;
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  // Resolve relative to cwd so callers can pass `.local/foo.jsonl`.
  const abs = isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
  try {
    mkdirSync(dirname(abs), { recursive: true });
  } catch {
    /* directory may already exist; mkdir is fine to let throw on real errors */
  }
  console.info(
    `[peppers-agent] PEPPERS_CAPTURE_LOG=${abs} — appending JSONL records per cascade`,
  );
  return abs;
})();

/** True when capture is enabled. Callers can short-circuit prep work. */
export function captureEnabled(): boolean {
  return CAPTURE_PATH !== null;
}

/**
 * Append one record to the capture file. The record is augmented with
 * a `timestamp` and `kind`, then serialised to a single line.
 *
 * No-op when capture is disabled. Errors writing are logged but never
 * thrown — capture must never break the cascade.
 */
export function captureRecord(kind: string, record: Record<string, unknown>): void {
  if (CAPTURE_PATH === null) return;
  const payload = {
    timestamp: new Date().toISOString(),
    kind,
    ...record,
  };
  try {
    appendFileSync(CAPTURE_PATH, JSON.stringify(payload) + "\n", "utf8");
  } catch (err) {
    console.warn(
      JSON.stringify({
        kind: "peppers-agent.capture-write-failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
