# Contract: Exam Snippet Format

**IC-001 + IC-002** | Authoring ↔ Quizmaster runtime ↔ Auditor

## Snippet serialization

Each `Problem` node in `.exam.gram` serializes to one UTF-8 string:

```
---\n
id: <id>\n
type: <type>\n
weight: <weight>\n
[options:\n  <key>: <label>\n  ...]    # multiple_choice only
[correct: <value>]                     # full artifact only
[tolerance: <value>]                   # numerical, full only
[answer: <value>]                      # submission record only
---\n
\n
<prompt text>\n
```

Rules:
- Frontmatter delimiters are exactly `---\n` (three hyphens, LF).
- Fields are serialized in the order shown above. No extra fields, no reordering.
- String values containing special YAML characters MUST be double-quoted.
- `options` block uses two-space indent per key.
- Body is separated from closing `---` by exactly one blank line.
- File ends with a single `\n` after the body.

## Artifact hash computation (IC-002)

```
snippets = [promptOnlySnippet(q) for q in problems, sorted by q.id lexicographically]
artifactRef = hex(sha256(Buffer.concat(snippets.map(s => Buffer.from(s, 'utf8')))))
```

Same formula for `disclosureRef` (full snippets) and `submissionRef` (submission snippets). Uses Node.js `node:crypto` — no new dependency.

## Example (prompt-only)

```markdown
---
id: q1
type: multiple_choice
weight: 2
options:
  a: Proof of Work
  b: Proof of Stake
  c: Delegated Proof of Stake
  d: PBFT
---

Which consensus algorithm is used by Bitcoin?
```

## Example (full — disclosureRef content)

```markdown
---
id: q1
type: multiple_choice
weight: 2
options:
  a: Proof of Work
  b: Proof of Stake
  c: Delegated Proof of Stake
  d: PBFT
correct: a
---

Which consensus algorithm is used by Bitcoin?
```

## Example (submission record — stored in EvalContract.submission)

```markdown
---
id: q1
type: multiple_choice
weight: 2
options:
  a: Proof of Work
  b: Proof of Stake
  c: Delegated Proof of Stake
  d: PBFT
correct: a
answer: a
---

Which consensus algorithm is used by Bitcoin?
```

## Auditor verification (no code required)

```bash
# Verify disclosureRef after reveal
cat q1.full.md q2.full.md q3.full.md | shasum -a 256

# Compare to disclosureRef on the contract
```
