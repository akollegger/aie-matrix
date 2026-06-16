# Quickstart: Structured Exam NPCs (031-exam-npcs)

## Prerequisites

- `pnpm install` from repo root
- Neo4j running (for ledger integration tests) or use in-memory service for unit tests
- NPC agent process configured with `NPC_CATALOG_DIR`

## 1. Author an exam

Create `ghosts/npc-agent/catalog/my-exam.exam.gram`:

```gram
(q1:Problem { type: "multiple_choice", weight: 2,
  options: { a: "Proof of Work", b: "Proof of Stake", c: "DPoS", d: "PBFT" } }
  -[r1:ExactMatch { correct: "a" }]->(:Options)
  `Which consensus algorithm does Bitcoin use?`)

(q2:Problem { type: "short_answer", weight: 1 }
  -[r2:ExactMatch { correct: "Satoshi Nakamoto" }]->(:Text)
  `Name the pseudonymous creator of Bitcoin.`)

[exam:Exam { schema_version: "1", exam_id: "01JXKP2W4BVKA3MN5QZGR7TDFE" } | q1, q2]
```

## 2. Add a quizmaster character

Create `ghosts/npc-agent/catalog/quizmaster.character.gram`:

```gram
{ kind: "matrix-character" }

(charQuizmaster:Character:Quizmaster {
  id: "quizmaster", name: "The Quizmaster", glyph: "🎓",
  background: "Tests knowledge and rewards those who demonstrate it.",
  enabled: true, defaultAction: "go-random",
  examPath: "my-exam.exam.gram", stakeAmount: 5
})

(idle:DialogNode { responses: ["I have questions for you. Reply **accept** to take the exam."] })
[dialog_1:DialogTree | (idle)-[:DialogTrigger { triggers: [] }]->(idle)]
(charQuizmaster)-[:HAS_DIALOG]->(dialog_1)
```

## 3. Add a contestant character

Create `ghosts/npc-agent/catalog/contestant.character.gram`:

```gram
{ kind: "matrix-character" }

(charContestant:Character:Contestant {
  id: "contestant", name: "The Contestant", glyph: "✏️",
  background: "Seeks out exams and answers every question it receives.",
  enabled: true, defaultAction: "go-random"
})

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
{ "kind": "quizmaster.exam-loaded", "artifactRef": "abc123...", "disclosureRef": "def456..." }
```

## 5. Observe the exam cycle

When contestant and quizmaster share a map cell, the quizmaster greets and offers. The contestant replies `accept`. Watch logs for:

```
quizmaster.contract.opened   contractId=...
quizmaster.question.sent     questionId=q1
contestant.answer.sent       questionId=q1 answer=a
quizmaster.question.sent     questionId=q2
contestant.answer.sent       questionId=q2 answer=Satoshi Nakamoto
quizmaster.verdict.posted    verdict=1.0
world-api.contract.settled   contractorPayment=5
```

## 6. Verify audit trail (optional)

After settlement, retrieve `EvalContract.submission` from the ledger. Split on `---` boundaries to get per-question snippets. Concatenate and hash:

```bash
echo -n "<submission text>" | shasum -a 256
# Should match sha256 of the filled-in snippets
```

## Unit tests

```bash
cd ghosts/npc-agent
pnpm test
# Covers: snippet compiler, hash computation, quizmaster state machine, contestant state machine
```

```bash
cd server/world-api
pnpm test
# Covers: EvalContract schema extension (in-memory service)
```
