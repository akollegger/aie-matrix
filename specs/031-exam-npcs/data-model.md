# Data Model: Structured Exam NPCs (031-exam-npcs)

## EvalContract (extended)

Extends the existing type in `shared/types/src/eval-contract.ts`.

New fields (nullable for backward compatibility with broker contracts):

| Field | Type | Description |
|---|---|---|
| `artifactRef` | `string \| null` | SHA-256 hex of the prompt-only snippet concatenation. Committed at `openContract`. |
| `disclosureRef` | `string \| null` | SHA-256 hex of the full snippet concatenation (with answer key). Committed at `openContract`, revealed after verdict. |

The existing `submission: string | null` field carries the full exam text (snippets with `answer:` fields filled in) when the quizmaster calls `submitContract`. The `verdict: number | null` is unchanged. Settlement is proportional: `ceil(verdict × stakeAmount)` — no pass/fail threshold.

**State machine**: unchanged. Quizmaster drives: `Open → Accepted → Submitted → Evaluated → Settled`.

---

## Question Snippet (artifact format)

One UTF-8 markdown document per `Problem` node. Concatenated in lexicographic `id` order.

### Prompt-only (artifactRef content)

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

### Full artifact (disclosureRef content — withheld)

Same as above plus `correct: a` in frontmatter.

### Submission record (submission field content — filled by quizmaster)

Same as full artifact plus `answer: <contestant_response>` in frontmatter.

### Frontmatter field registry

| Field | Present in | Type | Notes |
|---|---|---|---|
| `id` | all views | string | Stable problem identifier. Lexicographic sort key for concatenation. |
| `type` | all views | `multiple_choice` \| `short_answer` \| `numerical` | Determines answer format. |
| `weight` | all views | number | Relative weight in verdict formula. |
| `options` | prompt-only, full (multiple_choice only) | object (key→label) | Option identifiers are the valid answer values. |
| `correct` | full artifact only | string \| number | Withheld from prompt-only view. |
| `answer` | submission record only | string \| number | Contestant's response as recorded by quizmaster. |
| `tolerance` | full artifact only (numerical) | number | `|answer - correct| ≤ tolerance` for score 1.0. |

---

## ExamDefinition (quizmaster runtime state)

In-memory only. Populated at character load time from `.exam.gram`.

```typescript
interface QuestionSnippet {
  id: string;
  type: "multiple_choice" | "short_answer" | "numerical";
  weight: number;
  options?: Record<string, string>;  // multiple_choice only
  correct: string | number;
  tolerance?: number;                // numerical only
  promptText: string;                // markdown body
}

interface ExamDefinition {
  promptOnlySnippets: string[];    // serialized, ordered by id — concat → artifactRef
  fullSnippets: string[];          // includes correct — concat → disclosureRef
  artifactRef: string;             // hex SHA-256
  disclosureRef: string;           // hex SHA-256
  questions: QuestionSnippet[];    // for evaluation
}
```

---

## CharacterDefinition (extended)

Extends `CharacterDefinition` in `ghosts/npc-agent/src/types.ts`.

| Field | Type | Notes |
|---|---|---|
| `behaviorKind` | `"rule-engine" \| "broker" \| "quizmaster" \| "contestant"` | Two new variants. |
| `examPath` | `string \| undefined` | Absolute path to `.exam.gram`. Quizmaster only. |

---

## Quizmaster Runtime State

Per-ghost, in-memory (same pattern as broker's `ghostState` map).

```typescript
type QuizmasterState =
  | { phase: "idle" }
  | { phase: "greeting"; contestantId: string }
  | { phase: "conducting"; contractId: string; contestantId: string; questionIndex: number; answers: string[] }
  | { phase: "evaluating"; contractId: string; contestantId: string; answers: string[] };
```

---

## Contestant Runtime State

Per-ghost, in-memory.

```typescript
type ContestantState =
  | { phase: "idle" }
  | { phase: "answering"; contractId: string; quizmasterId: string; currentQuestionId: string };
```

---

## Scoring Formula

Unchanged from RFC-0022 / RFC-0027:

```
per_problem_score(q):
  exact_match:  1.0 if answer ∈ correct (case-insensitive for short_answer), else 0.0
  numerical:    1.0 if |answer - correct| ≤ tolerance, else 0.0

verdict = Σ(score_i × weight_i) / Σ(weight_i)
```

Settlement is proportional: contractor receives `ceil(verdict × stakeAmount)` credits; remainder is returned to client (quizmaster). The existing `evaluateContract` handles this — the quizmaster passes `verdict ∈ [0,1]` and the world computes the split.
