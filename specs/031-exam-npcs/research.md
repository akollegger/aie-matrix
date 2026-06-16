# Research: Structured Exam NPCs (031-exam-npcs)

## Gram Parsing in npc-agent

**Decision**: Use `@relateby/pattern` at its current `^0.4.2` pin (matching `shared/map-gram`) to parse `.exam.gram` at quizmaster startup. The same `parsePatterns` API used in `shared/map-gram/src/parse.ts` is available.

**Rationale**: The exam compiler runs once at character load time (not in the hot path). No migration to `0.6.0` is needed for MVP — the AST gives us `identity`, `labels`, and `properties` on each node/relationship, which is sufficient to emit markdown+frontmatter snippets.

**Alternatives considered**: Upgrading to `@relateby/pattern@0.6.0` for canonical JSON serialization (RFC-0027 recommendation). Deferred — the `0.4→0.6` migration spans `shared/map-gram` and `server/world-api` and is a separate spike.

---

## Markdown+Frontmatter Snippet Format

**Decision**: Hand-roll the serializer. Each `Problem` node becomes one UTF-8 `.md` string with YAML-style frontmatter delimited by `---`. No external frontmatter library is introduced.

**Rationale**: The frontmatter schema is small and fixed (5–6 known fields). A bespoke serializer costs ~30 lines and eliminates a new dependency. The hash is computed over the raw UTF-8 bytes of the serialized string — no parser is needed on the quizmaster side, only on an auditor's side (where `gray-matter` or any YAML parser works fine).

**Alternatives considered**: `gray-matter` for frontmatter parsing/serialization — reasonable but adds a dependency for a problem that doesn't require it at runtime. `@relateby/pattern` canonical JSON as the artifact — deferred with the 0.6.0 migration.

---

## Artifact Hashing

**Decision**: `sha256(Buffer.concat(snippets.map(s => Buffer.from(s, 'utf8'))))`, where snippets are ordered by `id` field lexicographically. Uses Node's built-in `node:crypto` — no new dependency.

**Rationale**: Consistent with RFC-0022's `hex(SHA-256(bytes))` convention already used in the ledger. Lexicographic ordering by `id` (q1, q2, q3…) is deterministic across runs and implementations. Already used in `server/world-api` for `artifactRef` hashing.

---

## EvalContract Schema Extension

**Decision**: Add two optional fields to `EvalContract` in `shared/types`: `artifactRef: string | null`, `disclosureRef: string | null`. The existing `submission` string field carries the full exam snippets-with-answers text; `verdict` already exists. Settlement is proportional: `ceil(verdict × stakeAmount)` — no `passMark` field.

**Rationale**: `submission` is already a nullable string — the quizmaster posts the concatenated filled-in snippets here. The `evaluateContract` method already triggers settlement proportional to verdict, so no new ledger action is needed.

**Alternatives considered**: A separate `submissionRef` hash field — not needed, the `submission` text is the canonical record. A new `post_verdict` MCP tool — not needed, `eval_contract_evaluate` already exists and is called by the broker today. A `passMark` threshold field — dropped; settlement is proportional (`ceil(verdict × stakeAmount)`), consistent with the existing formula.

---

## Behavior Dispatch Extension

**Decision**: Add `"quizmaster"` and `"contestant"` to the `behaviorKind` union in `CharacterDefinition`. The `Match.exhaustive` dispatch in `executor.ts`'s tick loop gains two new cases. World event routing for `world.contract.submitted` is extended to also dispatch to quizmaster behavior.

**Rationale**: Follows the exact pattern of the broker — zero new framework, minimal surface change. The `Match.exhaustive` exhaustiveness check catches any missed dispatch at compile time.

---

## Contestant Contract Discovery

**Decision**: The contestant's tick calls `listContracts` (via the MCP `eval_contract_list` tool if exposed, or via a direct world-API poll) filtering for `state: "Open"` contracts where `contractorId` matches the contestant's ghostId — i.e. contracts explicitly offered to it. It does not scan all open contracts.

**Rationale**: The quizmaster creates a contract naming the specific contestant as `contractorId` after greeting. This follows the broker pattern: the quizmaster offers, the contestant accepts. The contestant doesn't need ambient contract discovery — proximity-triggered greeting is the discovery mechanism.

**Alternatives considered**: Contestant polls for any open contract — simpler but would let contestants accept contracts from any client, not just quizmasters. Deferred for a future "open exam market" mechanic.
