# Quickstart: Structured Exam NPCs (031-exam-npcs)

## Prerequisites

- `pnpm install` from repo root
- Neo4j running (for ledger integration tests) or use in-memory service for unit tests
- NPC agent process configured with `NPC_CATALOG_DIR`

## 1. Author an exam

Create `ghosts/npc-agent/catalog/my-exam.exam.gram`:

```gram
{ kind: "matrix-exam", schema_version: "1" }

(q1:Problem { type: "multiple_choice", weight: 2, correct: "a",
  prompt: "Which consensus algorithm does Bitcoin use?",
  options: { a: "Proof of Work", b: "Proof of Stake", c: "DPoS", d: "PBFT" } })

(q2:Problem { type: "short_answer", weight: 1, correct: "Satoshi Nakamoto",
  prompt: "Name the pseudonymous creator of Bitcoin." })

[exam:Exam | q1, q2]
```

Key rules for the `.exam.gram` format:
- All question properties (type, weight, correct, prompt, options, tolerance) are inline on the `Problem` node — no backtick descriptions, no nested relationships.
- `options` is a map property (only for `multiple_choice`).
- `tolerance` is a numeric property (only for `numerical`), defaulting to 0.

See `catalog/bitcoin-basics.exam.gram` as a complete three-question example.

## 2. Add a quizmaster character

Create `ghosts/npc-agent/catalog/quizmaster.character.gram`:

```gram
{ kind: "matrix-character" }

(charQuizmaster:Character:Quizmaster { id: "quizmaster", name: "The Quizmaster", glyph: "🎓",
  background: "Tests knowledge and rewards those who demonstrate it.",
  enabled: true, defaultAction: "go-random",
  examPath: "my-exam.exam.gram", stakeAmount: 5 })

(idle:DialogNode { responses: ["I have questions for you. Reply **accept** to take the exam."] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle)]
(charQuizmaster)-[:HAS_DIALOG]->(dialog_1)
```

## 3. Add a contestant character

Create `ghosts/npc-agent/catalog/contestant.character.gram`:

```gram
{ kind: "matrix-character" }

(charContestant:Character:Contestant { id: "contestant", name: "The Contestant", glyph: "🎯",
  background: "Seeks out exams and answers every question it receives.",
  enabled: true, defaultAction: "go-random", stakeAmount: 0 })

(idle:DialogNode { responses: ["Ready to be tested."] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle)]
(charContestant)-[:HAS_DIALOG]->(dialog_1)
```

## 4. Run the NPC agent

```bash
cd ghosts/npc-agent
pnpm dev
```

On startup the quizmaster logs:
```json
{ "kind": "quizmaster.exam-loaded", "examPath": "my-exam.exam.gram",
  "questionCount": 2, "artifactRef": "abc123...", "disclosureRef": "def456..." }
```

## 5. Observe the exam cycle

When contestant and quizmaster share a map cell, the quizmaster greets and offers the exam. The contestant replies `accept`. Watch logs for:

```
{ "kind": "quizmaster.answer-recorded", "questionId": "q1", "score": 0 }
{ "kind": "quizmaster.answer-recorded", "questionId": "q2", "score": 0 }
{ "kind": "quizmaster.exam-complete", "verdict": 0 }
{ "kind": "contestant.exam-complete" }
```

After settlement the quizmaster sends a final `say()` message containing the full artifact (all snippets with answer keys). The contestant's credit balance increases by `ceil(verdict × stakeAmount)`.

## 6. Verify the audit trail

After settlement, retrieve the quizmaster's final `say()` message from the conversation thread. The message body is the full artifact text. Compute its SHA-256 and compare against `disclosureRef` on the settled contract:

```bash
# Extract full artifact bytes from the quizmaster's post-settlement message
# then run:
printf '%s' "<full artifact text>" | shasum -a 256
# Output should match the disclosureRef on the EvalContract
```

The `artifactRef` committed at exam-open covers the prompt-only snippets (no answer keys). The `disclosureRef` covers the full snippets. Both are stored on the `EvalContract` node in Neo4j.

## Unit tests

```bash
cd ghosts/npc-agent
pnpm test
# Covers: exam gram parsing, snippet compiler, hash computation,
#         quizmaster state machine (scoring, sequencing, verdict),
#         contestant state machine (accept, answer generation)
```

```bash
cd server/world-api
pnpm test
# Covers: EvalContract schema extension (artifactRef, disclosureRef),
#         proportional settlement formula
```
