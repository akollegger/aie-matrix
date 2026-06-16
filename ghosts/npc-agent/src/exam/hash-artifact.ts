import { createHash } from "node:crypto";

/**
 * Compute SHA-256 hex over the concatenation of UTF-8 snippet bytes.
 * Snippets must already be ordered lexicographically by question id (done by the parser).
 */
export function hashSnippets(snippets: string[]): string {
  const hash = createHash("sha256");
  for (const s of snippets) {
    hash.update(Buffer.from(s, "utf8"));
  }
  return hash.digest("hex");
}
