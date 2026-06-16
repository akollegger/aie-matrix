# Feature Specification: Structured Exam NPCs (Quizmaster & Contestant)

**Feature Branch**: `031-exam-npcs`  
**Created**: 2026-06-16  
**Status**: Draft  

## Clarifications

### Session 2026-06-16

- Q: How does the quizmaster deliver exam questions during the conversation? → A: One question at a time; quizmaster waits for contestant reply before sending the next.
- Q: Can a single quizmaster conduct exams with multiple contestants simultaneously? → A: One active exam at a time; quizmaster declines new offers while an exam is in progress.
- Q: How are question-answer exchanges recorded in the verifiable event log? → A: One entry per exchange — question and contestant answer recorded together after the answer is received.

## Proposal Context *(mandatory)*

- **Related Proposals**:
  - [RFC-0022](../../proposals/rfc/0022-eval-contract-protocol.md) — Eval Contract Protocol (commit-reveal, ledger settlement)
  - [RFC-0023](../../proposals/rfc/0023-in-world-resource-ledger.md) — In-World Resource Ledger / Verifiable Event Log
  - [RFC-0027](../../proposals/rfc/0027-structured-exam-artifact.md) — Structured Exam Artifact Format (gram authoring → markdown+frontmatter artifact)
- **Scope Boundary**: Two new NPC behavior types — quizmaster and contestant — that conduct structured, contractually-bound exams through conversation, with a verifiable event log as the audit trail. Updates to RFC-0027 to record the resolved format (human-authored gram, compiled to markdown+frontmatter). Two new nullable fields (`artifactRef`, `disclosureRef`) on EvalContract; settlement is proportional to verdict.
- **Out of Scope**: Human contestants (covered by RFC-0030 human ghost peer; the conversational interface is the same, the client rendering is a separate concern). Cryptographic signing of contestant answers (trust extension deferred). Model-graded (`open_ended`) auto-evaluation (deferred; MVP uses only auto-gradable question types). Round-trip QTI interoperability (RFC-0027 Open Question 6, deferred).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ghost takes a quizmaster exam and earns credits (Priority: P1)

A contestant ghost encounters a quizmaster NPC, accepts an offered exam contract, answers questions through conversation, and receives a proportional credit payout based on their score.

**Why this priority**: This is the complete happy-path loop — every other story is either setup or a sub-step of this one. If this works end-to-end, the feature is demonstrably live.

**Independent Test**: Deploy quizmaster and contestant NPCs in a test session. Contestant should automatically find the quizmaster, accept the contract, complete the exam, and have credits transferred — observable in the ledger without any manual intervention.

**Acceptance Scenarios**:

1. **Given** a quizmaster NPC is online with a loaded exam, **When** a contestant ghost enters the same map cell or nearby proximity, **Then** the quizmaster greets the contestant and offers an exam contract with stated payout.
2. **Given** an exam contract is offered, **When** the contestant accepts, **Then** the contract is recorded on the ledger with `artifactRef` (prompt-only hash) and `disclosureRef` (full artifact hash) committed.
3. **Given** a contract is active, **When** the quizmaster delivers each question conversationally, **Then** the contestant responds with an answer and the exchange is recorded in the verifiable event log.
4. **Given** all questions are answered, **When** the quizmaster evaluates answers against the withheld answer key, **Then** a verdict `[0,1]` is computed and posted to the ledger as `post_verdict`.
5. **Given** a computed verdict (e.g. 0.67 for 2 of 3 correct), **When** settlement runs, **Then** the contestant receives `ceil(verdict × stakeAmount)` credits and the quizmaster receives the remainder.

---

### User Story 2 — Exam artifact is auditable after settlement (Priority: P2)

After a completed exam contract, any party can verify that the quizmaster's verdict was computed honestly: the revealed answer key matches the committed `disclosureRef`, and the contestant's answers as recorded match the event log.

**Why this priority**: Auditability is the purpose of the commit-reveal protocol. Without it the quizmaster is just a chatbot that hands out credits arbitrarily.

**Independent Test**: After a completed exam, run `shasum -a 256` on the revealed full artifact and confirm it matches the `disclosureRef` on the contract. Confirm the contestant's answers in the event log match the `answer` fields the quizmaster recorded before posting verdict.

**Acceptance Scenarios**:

1. **Given** a settled exam contract, **When** the full artifact (with answer key) is retrieved from the quizmaster's reveal `say()` message in the conversation thread, **Then** its SHA-256 hash matches the `disclosureRef` committed at contract creation.
2. **Given** a settled exam contract, **When** the event log entries for the exam conversation are inspected, **Then** each contestant answer appears verbatim as recorded by the quizmaster in the submission.
3. **Given** a prompt-only artifact, **When** its SHA-256 is computed, **Then** it matches the `artifactRef` on the contract — confirming both artifacts are views of the same exam.

---

### User Story 3 — Quizmaster loads a gram-authored exam at startup (Priority: P3)

A quizmaster character is configured with a path to a `.exam.gram` file. At startup it compiles the gram source to per-question markdown+frontmatter snippets, computes both artifact hashes, and holds them in memory ready to conduct exams.

**Why this priority**: This validates the authoring pipeline (gram → markdown+frontmatter) and the artifact format described in RFC-0027's resolution. Without it quizmaster content is hard-coded.

**Independent Test**: Point a quizmaster at a known `.exam.gram` file. On startup, confirm it logs both computed hashes. Manually verify a snippet's frontmatter and body match the gram source.

**Acceptance Scenarios**:

1. **Given** a valid `.exam.gram` file, **When** the quizmaster process starts, **Then** it emits one markdown+frontmatter snippet per `Problem` node, with `id`, `type`, `weight`, and `options` (if applicable) in frontmatter and the prompt as the body.
2. **Given** the compiled snippets, **When** hashes are computed, **Then** `artifactRef = sha256(concat of prompt-only snippets ordered by problem id)` and `disclosureRef = sha256(concat of full snippets with correct answers)`.
3. **Given** the two hashes are computed, **When** the quizmaster creates a contract, **Then** both hashes are recorded on the ledger before any exam conversation begins.

---

### Edge Cases

- What happens if a contestant disconnects mid-exam? The quizmaster waits for a timeout, then closes the contract with a 0 verdict.
- What if a problem's answer is ambiguous (e.g., multiple accepted spellings for `short_answer`)? The quizmaster's rubric defines accepted values; MVP uses exact-match with case-insensitive comparison.
- What if the quizmaster's gram file is missing or invalid at startup? The character fails to load and logs an error; no contract is offered.
- What if a contestant approaches while the quizmaster already has an active exam in progress? The quizmaster declines with a brief message and remains in the active exam until it settles.
- What if a contestant is already in an active exam contract with another quizmaster? The contestant declines new offers until its current contract is settled.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The quizmaster NPC MUST load a human-authored `.exam.gram` file at startup and compile it to per-question markdown+frontmatter snippets.
- **FR-002**: The quizmaster MUST compute `artifactRef` (prompt-only snippets concatenated and hashed) and `disclosureRef` (full snippets with answer key concatenated and hashed) before offering any contract.
- **FR-003**: The quizmaster MUST create an eval contract on the ledger committing both `artifactRef` and `disclosureRef` before delivering exam questions.
- **FR-004**: Exam questions MUST be delivered conversationally via `say()` — the markdown body as prose, options rendered as a readable list. The quizmaster sends one question at a time and waits for the contestant's reply before sending the next.
- **FR-005**: Each question-answer exchange MUST be recorded as a single entry in the verifiable event log (RFC-0023), logged after the contestant's answer is received, containing both the question posed and the answer given.
- **FR-006**: The quizmaster MUST evaluate answers against the withheld rubric after all questions are answered, using case-insensitive exact-match comparison for all question types (`short_answer`, `multiple_choice` option identifiers, and `numerical` string representations).
- **FR-007**: After evaluation, the quizmaster MUST call `evaluateContract` with the computed `verdict` float `[0,1]`. The existing ledger action handles proportional settlement; no new ledger action is required.
- **FR-008**: After posting verdict, the quizmaster MUST send the full artifact bytes (full snippets with answer key) directly to the contractor via `say()`. The ledger holds the hash commitment (`disclosureRef`); the bytes travel via direct conversation so auditors with access to that thread can verify `sha256(bytes) === disclosureRef`. The bytes are NOT posted to the ledger — doing so would expose the answer key to future contestants.
- **FR-009**: The ledger MUST settle the contract proportionally — transferring `ceil(verdict × stakeAmount)` credits to the contestant, returning the remainder to the quizmaster.
- **FR-010**: The contestant NPC MUST monitor its inbox for exam contract offers from quizmasters, accept any offer it receives, answer all questions in the exam through conversation, and wait for settlement.
- **FR-011**: The contestant MUST answer every question in the exam; skipped questions count as no response (scored 0).
- **FR-012**: The exam MUST support only auto-gradable question types in the MVP: `multiple_choice`, `short_answer`, and `numerical`.

### Key Entities

- **Exam Artifact (prompt-only)**: The concatenation of per-question markdown+frontmatter snippets with `correct` fields absent. Its SHA-256 is the `artifactRef`. Human-readable; auditable with `cat` + `shasum`.
- **Exam Artifact (full)**: Same snippets with `correct` fields present. Its SHA-256 is the `disclosureRef`. Withheld by quizmaster until after submission.
- **Submission Record**: The full snippets with `answer` fields filled in by the quizmaster based on the contestant's conversational responses. Its SHA-256 is the `submissionRef`.
- **Eval Contract**: Ledger record extended with `artifactRef` and `disclosureRef` (both nullable). Existing `submission`, `verdict`, and proportional settlement are unchanged in structure.
- **Question Snippet**: One markdown+frontmatter document per exam problem. Frontmatter carries `id`, `type`, `weight`, `options` (if multiple choice), and — in the full artifact — `correct`. Body is the question prose.
- **Quizmaster Character**: NPC with `behaviorKind: "quizmaster"`. Gram properties: `examPath`, `stakeAmount`.
- **Contestant Character**: NPC with `behaviorKind: "contestant"`. Polls world for open exam contracts and participates automatically.

### Interface Contracts

- **IC-001**: Question snippet format — markdown+frontmatter. Frontmatter fields: `id` (string, stable), `type` (`multiple_choice` | `short_answer` | `numerical`), `weight` (number), `options` (object, multiple_choice only), `correct` (full artifact only), `answer` (submission record only). Body: question prose.
- **IC-002**: Artifact hash computation — `sha256(Buffer.concat([snippet1, snippet2, ...]))` where snippets are UTF-8 bytes, ordered by `id` lexicographically. Consistent with RFC-0022's `hex(SHA-256(bytes))` convention.
- **IC-003**: `evaluateContract` ledger action (existing) — quizmaster calls with `{ contractId, verdict: number }`. Settlement is `ceil(verdict × stakeAmount)`. No new ledger action required.
- **IC-004**: Gram-to-snippet compiler — given a `Problem` node with an `[:ExactMatch | :Numerical]` rubric edge in `.exam.gram`, emits one `.md` snippet. Input: `@relateby/pattern` AST. Output: markdown string. This is an internal build-time interface in the quizmaster behavior module.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A contestant NPC completes a full exam cycle (contract creation → question delivery → answer submission → verdict → settlement) without any manual intervention, in under 60 seconds for a 3-question exam.
- **SC-002**: The SHA-256 of the revealed full artifact matches the `disclosureRef` committed at contract creation in 100% of completed exams.
- **SC-003**: A new exam can be authored by editing a single `.exam.gram` file and restarting the quizmaster — no code changes required.
- **SC-004**: The event log for a completed exam contains one entry per question-answer exchange and a verdict entry. The full artifact bytes are delivered to the contractor via direct message after settlement, not stored in the ledger.
- **SC-005**: An auditor with access to the exam conversation thread and the contract record can verify integrity using only `shasum`: extract the full artifact bytes from the quizmaster's reveal message, compute `sha256`, confirm it matches `disclosureRef` on the contract.

## Assumptions

- Happy-path trust model: the quizmaster is assumed honest in recording contestant answers. Disputes require human review of the event log. Cryptographic answer signing is deferred.
- MVP exam question types are limited to `multiple_choice`, `short_answer`, and `numerical` — all auto-gradable without an LLM evaluator call.
- The quizmaster holds a single exam. Multi-exam quizmasters are out of scope.
- The contestant always agrees to any offered exam contract. Refusal logic and strategy are out of scope.
- The `@relateby/pattern` package is available at `^0.4.2` (current project pin) for gram parsing in the quizmaster. The canonical `Pattern<Subject>` JSON upgrade (RFC-0027 Open Question 7) is deferred — the gram-to-snippet compiler operates on the AST directly.
- Progressive multi-stage exams (RFC-0027 S4) are out of scope for MVP. All questions are delivered in a single stage.
- The contestant ghost does not need proximity to the quizmaster to accept a contract (polling world-API directly).

## Documentation Impact *(mandatory)*

- **RFC-0027** (`proposals/rfc/0027-structured-exam-artifact.md`): Add a **Resolution** section closing the format debate — humans author `.exam.gram`, the quizmaster compiles it to markdown+frontmatter at startup, markdown+frontmatter is the exchange artifact and hash target, the artifact format and hash content are decoupled. Update Open Questions to mark resolved items.
- **RFC-0022** (`proposals/rfc/0022-eval-contract-protocol.md`): Add `post_verdict` action and `verdict` / `submissionRef` fields to the `EvalContract` schema. Clarify that `submissionRef` is the quizmaster's record of contestant answers (not a self-signed submission) for the MVP trust tier.
- `ghosts/npc-agent/README.md`: Document the `quizmaster` and `contestant` behavior kinds and the `.exam.gram` authoring workflow.
