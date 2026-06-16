import type { QuestionSnippet } from "./parse-exam-gram.js";

/**
 * Serialize a question to canonical markdown+frontmatter (prompt-only view).
 * The `correct` field is omitted — this is the artifact exposed to the contestant.
 */
export function toPromptOnly(q: QuestionSnippet): string {
  return serializeSnippet(q, { includeCorrect: false, answer: undefined });
}

/**
 * Serialize a question to canonical markdown+frontmatter (full view with answer key).
 * Used to compute `disclosureRef`.
 */
export function toFull(q: QuestionSnippet): string {
  return serializeSnippet(q, { includeCorrect: true, answer: undefined });
}

/**
 * Serialize a question with the contestant's answer filled in.
 * Used to build the submission record (`EvalContract.submission`).
 */
export function toSubmission(q: QuestionSnippet, answer: string): string {
  return serializeSnippet(q, { includeCorrect: true, answer });
}

// ── Internal serializer ───────────────────────────────────────────────────────

interface SerializeOpts {
  includeCorrect: boolean;
  answer: string | undefined;
}

function serializeSnippet(q: QuestionSnippet, opts: SerializeOpts): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${q.id}`);
  lines.push(`type: ${q.type}`);
  lines.push(`weight: ${q.weight}`);

  if (q.options) {
    lines.push("options:");
    for (const [k, label] of Object.entries(q.options)) {
      lines.push(`  ${k}: ${maybeQuote(label)}`);
    }
  }

  if (opts.includeCorrect) {
    lines.push(`correct: ${maybeQuote(String(q.correct))}`);
    if (q.tolerance !== undefined) {
      lines.push(`tolerance: ${q.tolerance}`);
    }
  }

  if (opts.answer !== undefined) {
    lines.push(`answer: ${maybeQuote(opts.answer)}`);
  }

  lines.push("---");
  lines.push("");
  lines.push(q.promptText);
  lines.push("");

  return lines.join("\n");
}

const YAML_SPECIAL = /[:#\[\]{},|>&*!'"@%`]/;

function maybeQuote(s: string): string {
  if (YAML_SPECIAL.test(s) || s.includes("\n") || s.startsWith(" ") || s.endsWith(" ")) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}
