/**
 * Tiny shared parsing utilities for LLM JSON responses across the Id
 * pipeline stages.
 */

export function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`${name} must be non-empty string; got ${JSON.stringify(v)}`);
  }
  return v.trim();
}
