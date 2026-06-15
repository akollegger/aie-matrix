# RFC-0027: Structured Exam Artifact Format

**Status:** draft  
**Date:** 2026-06-15  
**Authors:** @akollegger  
**Depends on:** [RFC-0022](0022-eval-contract-protocol.md) (Eval Contract Protocol — commit-reveal addendum)  
**Supersedes:** RFC-0022 Addendum "Structured Problem and Answer Schema" (2026-06-15)  
**Related:** [RFC-0023](0023-in-world-resource-ledger.md) (In-World Resource Ledger — verifiable event log addendum)

---

## Summary

An eval contract (RFC-0022) commits to the *hash* of a work artifact rather than the artifact itself. For that commitment to mean anything, all parties must agree on what a valid artifact looks like: how problems are posed, how answers are structured, and how a submission is scored. This RFC defines the **problem** the artifact format must solve — a prioritized set of requirements and the scenarios the format must support — and then evaluates six candidate encodings (**JSON**, **JSONL**, **GIFT**, **gram**, **YAML**, and **XML/QTI**) against that problem. Each candidate is given a genuine attempt in an appendix, then assessed on the requirements and on quality attributes. The body concludes with a comparison matrix and a *tentative* recommendation offered for discussion, not as a settled decision.

This document is deliberately structured to invite problem-solving rather than to defend a pre-chosen format. The requirements and scenarios (Sections 3–4) are the stable contract; the format choice (Section 6) is open for comment.

---

## Motivation

RFC-0022's commit-reveal addendum establishes that the eval contract holds a hash of the work artifact rather than the artifact itself. The hash is only useful as a commitment if all parties agree on what a valid artifact looks like. Without a shared format:

- An evaluator receiving a submission has no machine-readable rubric and must guess or always award full credit (as the current broker does).
- A contractor receiving an exam has no specified response format and cannot know whether to write prose, select an option, or provide a number.
- A hash commitment to an unspecified blob is tamper-evident but meaningless — it proves *something* was agreed to, not *what*.

The current `EvalContract.request` field is an untyped string; the broker encodes it as `JSON.stringify({ question: "..." })`. This is enough to demonstrate the protocol but not enough to support auto-grading, multi-question exams, withheld answer keys, or staged disclosure. This RFC defines what a real artifact format must do, and which encoding best does it.

---

## Requirements

Requirements are split into **functional requirements** (pass/fail — they determine whether a format is *eligible*) and **quality attributes** (graded — they determine which eligible format is *preferable*). Each functional requirement states a priority and a concrete success metric.

Priorities: **P0 (Must)** — the format cannot serve the eval-contract protocol without it. **P1 (Should)** — absence forces awkward workarounds or blocks a known near-term use.

### Functional requirements

| ID | Priority | Requirement | Satisfied when |
|----|----------|-------------|----------------|
| **R1** | P0 | **Multiple problem types** — open-ended (prose), multiple-choice (one-of-N), short-answer (brief text), numerical (number ± tolerance). Binary (yes/no) is multiple-choice with two options. | An exam can express all four types and a contractor can determine the expected response shape from the problem alone, with no out-of-band convention. |
| **R2** | P0 | **Stable, scoped problem identity** — each problem has an identifier that survives every view of the exam, scoped so that identifiers from different exams cannot collide. | Given two exams that both use a local id `q1`, a submission answer can be paired to exactly one problem in exactly one exam with no ambiguity. |
| **R3** | P0 | **Separable answer concerns** — the same exam must be expressible as a *prompt-only* view (no answer material) and a *full* view (with rubric/answer key), mechanically derivable from one source. | A prompt-only artifact contains zero answer-key bytes; the full artifact has a different hash; both are provably the same exam by shared identity. |
| **R5** | P0 | **Self-contained rubric** — scoring criteria are embedded in the artifact; no external registry, service, or lookup is required to evaluate a submission. | An evaluator can compute a score from `{full artifact, submission}` alone. No field references an external grader by id or URL. |
| **R6** | P0 | **Single weighted verdict** — per-problem weights aggregate to one verdict on a continuous \[0, 1\] scale, deterministically for auto-gradable problems. | Applying the verdict formula to a scored submission yields exactly one value in \[0, 1\]; exact-match and numerical problems need no human input. |
| **R8** | P0 | **Hashable identity** — the artifact serializes to a stable byte sequence verifiable against a committed hash. | Two parties holding the same artifact bytes compute the same SHA-256; the prompt-only and full artifacts each verify against their committed refs in RFC-0022. |
| **R4** | P1 | **Progressive disclosure** — an exam may be partitioned into ordered stages, each independently hashable and revealable, recomposing into one exam with one verdict. | An exam splits into ≥2 stages sharing identity; each stage hashes independently and is committed as its own `disclosureRef`; the stages recompose to a single verdict. |
| **R7** | P1 | **Partial responses** — a submission need not answer every problem; omitted problems contribute zero. | A submission omitting answers is valid and scores omitted problems as 0 toward the weighted aggregate. |

> *(IDs preserve continuity with prior drafts: R1–R8 minus the retired binary/versioning items. R4 and R7 are renumbered out of strict order to group P0 above P1.)*

### Quality attributes (graded, not pass/fail)

| ID | Attribute | What "good" looks like |
|----|-----------|------------------------|
| **Q1** | **Human authorability** | A subject-matter expert can write and read an exam by hand without specialized tooling or visual noise. |
| **Q2** | **Parser availability (base layer)** | A library that turns bytes into a generic structure is widely available in the project's stack (TypeScript/Node). *Note: the base parser yields a tree, not an exam — schema-aware interpretation (step 3 below) is required for every format regardless.* |
| **Q3** | **Composition & reuse** | Shared elements (option pools, rubric kinds, stages) can be defined once and referenced, rather than duplicated. |
| **Q4** | **Project fit** | The format aligns with formats and tooling already in the repo (`.map.gram`, `.character.gram`, JSON configs). |
| **Q5** | **Generation-time byte stability** | When generated *programmatically*, the same logical exam reliably produces the same bytes across runs/libraries — i.e., a producer can regenerate-and-recommit idempotently. Minor: reproducibility across *different* producers is not required (see R8 note). Hand-authored files are maximally stable for any format — the bytes are what the author saved. |

---

## Domain Reference — A Targeted Subset of QTI

The requirements above were derived from this protocol's needs, but they do not exist in a vacuum: digital assessment has an established interoperability standard, **[QTI 3.0](https://www.imsglobal.org/spec/qti/v3p0/oview)** (1EdTech, final 2022). This RFC treats QTI as the **domain reference** — the yardstick the item/test model is measured against — while deliberately targeting only a **subset** of it. The subset is not a shortcut; it *is* the design statement.

Two things make QTI the right reference:

- **Independent convergence validates our seams.** R3 (separate prompt / answer key / scoring) and R4 (staged sections) were reasoned from the contract protocol's needs; QTI reaches the identical structure through seven years of domain work — `qti-item-body` / `qti-response-declaration` / `qti-response-processing`, and `qti-assessment-section` / `qti-test-part`. When a homegrown model and the field's standard agree on where to cut, the cuts are real.
- **It is a completeness checklist.** QTI maps territory we have not walked (adaptive branching, outcome processing across items, feedback, technology-enhanced items, accessibility). Checking our schema against it is a cheap way to avoid discovering a missing requirement during implementation.

### Concept map — what we adopt, what we omit, what is ours

| This RFC | QTI 3.0 concept | Disposition |
|---|---|---|
| R1 problem types | interaction types (`choice`, `text-entry`, `extended-text`, numeric) | **adopt a subset** — four types, not QTI's full interaction set |
| R2 problem identity | `identifier` attributes / IDREF | **adopt** directly |
| R3 prompt / key / scoring separation | `item-body` / `response-declaration` / `response-processing` | **adopt** the structural model |
| R4 staging | `assessment-section` / `test-part` / sequencing | **adopt the static case**; defer QTI's adaptive sequencing |
| R6 weighted verdict | `outcome-processing` with weights | **adopt** the weighting model |
| — | accessibility (APIP), feedback blocks, portable custom interactions, presentation/rendering | **omit** — delivery/UX concerns outside an agent-to-agent contract |
| commit-reveal, `artifactRef` hashing, escrow-triggering verdict | *(no QTI analog)* | **ours** — the contract envelope from RFC-0022; QTI is silent here |

The bottom two rows are the point. We omit QTI's delivery surface because the exam here is exchanged between agents under a hash commitment, not rendered to a student in a browser — so accessibility, presentation, and proctoring are out of scope. And QTI has no notion of our contract envelope (a withheld answer key committed as a `disclosureRef`, a verdict that releases escrow), so the standard cannot define the part of the problem most specific to us. Targeting a subset is therefore the honest fit: **take QTI's hard-won assessment-item model, leave its LMS-delivery model, and add the contract layer it lacks.**

Whether that subset should be *round-trippable* with real QTI — so exams authored in standard tools could be imported and ours exported — is a larger commitment than using QTI as a reference; see Open Question 6.

---

## Scenarios

A candidate format is evaluated by attempting each scenario. These are the format's acceptance tests; they are encoding-agnostic and exercise the discriminating requirements. All scenarios use one running example — a Bitcoin-consensus exam — so the encodings in the appendices are directly comparable.

**S1 — Single open-ended question.** The broker's current use. One prose question with a human or model rubric. Exercises R1, R5, R6, R8.

**S2 — Mixed multi-question exam.** One `multiple_choice` (auto-graded), one `short_answer` (auto-graded), one `open_ended` (model-graded), with unequal weights, aggregating to one verdict. Exercises R1, R5, R6, and Q3 (does the format reuse an option pool, or duplicate it?).

**S3 — Commit-reveal with a withheld answer key.** The client commits the *prompt-only* artifact as `artifactRef`, withholds the *full* artifact (with rubric) as a `disclosureRef`, and reveals it after submission. Any party re-hashes the revealed full artifact to confirm it matches the commitment and is the same exam as the prompt-only view. Exercises R3, R8.

**S4 — Progressive multi-stage exam.** A two-stage exam where stage 2 is revealed only after stage 1 is answered. Each stage is independently committed and revealed; the whole produces one verdict. Exercises R2 (ids stable across staged reveals), R4, and Q3 (stage composition).

The **hashing and commit-reveal mechanics** of S3 are identical for every format: `ref = hex(SHA-256(bytes(artifact)))`, computed over whatever bytes the format produces. The interesting differences between formats are in S2 (composition), S3 (how cleanly a prompt-only view is *derived* from the full source), and S4 (whether staging is native or bolted on).

---

## Candidate Approaches

Each candidate is fully worked in an appendix: it attempts S1–S4 with the running example, then states where it satisfies or fails each functional requirement and how it rates on the quality attributes.

- **Appendix A — JSON.** A document with a `problems[]` array; rubric embedded per problem via a `kind` discriminant.
- **Appendix B — JSONL.** One problem per line; a header line carries exam-level fields.
- **Appendix C — GIFT.** Moodle's plain-text question DSL, with embedded answers and inline partial-credit.
- **Appendix D — gram.** The project's hierarchical pattern notation; rubric as relationship, options as reusable components, stages as composition.
- **Appendix E — YAML.** JSON's data model with better authoring ergonomics, anchors for reuse, and the LLM-eval ecosystem's de-facto config format.
- **Appendix F — XML/QTI.** 1EdTech's Question & Test Interoperability 3.0 — the established assessment-interchange standard, with item/response/processing separation and native test/section composition.

**Also considered, not given a full appendix.** *CBOR / Protocol Buffers / Avro* — binary serializations whose one selling point (deterministic encoding) is moot now that canonicalization is established as unnecessary for hashing; all fail human-authoring (Q1) and are relevant only as a transport/hash target the protocol does not require. *Markdown + YAML frontmatter* (promptfoo's agent style) — pleasant for prose prompts, but its structured part is YAML, so it collapses into the YAML case. *TOML* — config-oriented; weak for the nested, array-heavy, reuse-bearing structure an exam needs.

---

## Evaluation

### Functional requirements (eligibility)

| Requirement | JSON | JSONL | GIFT | gram | YAML | XML/QTI |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| R1 problem types (P0) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| R2 stable scoped identity (P0) | ✅ | ✅ | ❌ no per-question id | ✅ | ✅ | ✅ `identifier` attrs |
| R3 separable concerns (P0) | ✅ field-strip | ✅ field-strip | ⚠️ parse+strip inline answers | ✅ subgraph projection | ✅ field-strip | ✅ body/response/processing are separate elements |
| R5 self-contained rubric (P0) | ✅ | ⚠️ deviates from standard JSONL | ✅ inline | ✅ rubric-as-edge | ✅ | ✅ inline `response-processing` (⚠️ stock templates are external refs) |
| R6 single weighted verdict (P0) | ✅ | ✅ | ✅ (`%N%`) | ✅ | ✅ | ✅ weighted `outcome-processing` |
| R8 hashable identity (P0) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| R4 progressive disclosure (P1) | ⚠️ staging convention | ✅ per-line natural | ❌ positional, no identity | ✅ native stages | ⚠️ staging convention (or `---` docs) | ✅ native sections + adaptive |
| R7 partial responses (P1) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**R8 is non-discriminating — every row is ✅.** SHA-256 accepts any byte sequence, so hashability is a property of bytes, not of formats. The artifact *is* the bytes its author commits; any party re-hashes those exact bytes to verify. Earlier drafts scored "canonical serialization" in this row, which conflated two different things: *hashability* (universal) and *byte-reproducibility* (whether independent producers regenerate identical bytes for the same logical exam). The latter was explicitly rejected as a requirement — isomorphic encodings of one exam are distinct artifacts with distinct hashes, by design. What survives of byte-reproducibility is a generation-time footgun, captured under Q5, not under R8. R8 stays in the list only as a reminder that the commitment works for *any* format — including the rejected opaque blob, which hashes perfectly well and fails on interpretability alone.

**GIFT is ineligible:** it fails R2 (P0) — questions have no stable identifier, so answer pairing is positional and breaks under staged reveals (R4) and under any reordering. This is structural, not a tooling gap. GIFT remains valuable as the *authoring inspiration* (embedded rubric, inline partial credit) but cannot be the artifact-of-record.

**JSONL is eligible but compromised:** it satisfies the P0 set only by deviating from the convention that makes JSONL recognizable (grading registered out-of-band). Once you embed the rubric per line and add a header line for exam-level fields, you have idiosyncratic JSON-per-line with weaker composition than plain JSON — its one genuine advantage (independent per-line hashing) is real but narrow.

**YAML is fully eligible.** It shares JSON's data model, so it clears the P0 set identically (staging via a `stage` field, R4). What sets it apart sits at the quality layer: better hand-authoring, native reuse through anchors/aliases, and — uniquely among the candidates — it is the *de-facto authoring format of the LLM-eval ecosystem* (EleutherAI's lm-eval-harness and promptfoo both express tasks and rubrics in YAML). Its liability is also at the quality layer: type-coercion footguns make it the least byte-stable candidate.

**XML, via QTI 3.0, is the most completely eligible candidate and the field's established standard.** 1EdTech's Question & Test Interoperability 3.0 (final, 2022) is *the* interoperability standard for assessment items and tests, and it satisfies the requirements structurally rather than by convention: `identifier` attributes (R2); an item model that separates `item-body` (prompt), `response-declaration` (answer key), and `response-processing` (scoring), making R3 and R5 first-class; `assessment-section` / `test-part` composition with native sequencing and adaptive testing (R4); and weighted `outcome-processing` (R6). It is the strongest reference point available — and, by a wide margin, the heaviest to adopt; see the quality assessment and Appendix F.

**Four formats are fully eligible — JSON, gram, YAML, and XML/QTI — with JSONL eligible-but-compromised.** The decision among them is made on quality attributes, where it resolves into an *authoring* tradeoff: gram (native structure, in-repo fit), YAML (best ergonomics, eval-domain familiarity), JSON (ubiquity), and XML/QTI (maximal capability at maximal weight).

### Quality attributes (preference)

| Attribute | JSON | JSONL | GIFT | gram | YAML | XML/QTI |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Q1 human authorability | ⚠️ verbose | ⚠️ verbose | ✅ excellent | ✅ concise | ✅ good (comments, less syntax) | ❌ heavy (namespaces, tags) |
| Q2 parser availability (base layer) | ✅ universal | ✅ universal | ⚠️ thin TS ecosystem | ✅ stock JSON to consume (canonical `Pattern<Subject>`); codec only to author | ✅ universal | ✅ XML universal; ⚠️ QTI tooling heavy |
| Q3 composition & reuse | ❌ duplicate options | ❌ worse (no container) | ❌ | ✅ named components, stages | ⚠️ anchors reuse; no native composition | ✅ sections, refs, response templates |
| Q4 project fit | ✅ JSON configs | ⚠️ | ❌ | ✅ `.map.gram` precedent | ⚠️ eval-ecosystem standard, not in-repo | ❌ in-repo / ✅ domain standard |
| Q5 generation-time byte stability | ⚠️ key ordering varies; needs a generator convention | ⚠️ same, per line | ➖ no canonical form, but typically hand-authored | ✅ canonical serializer eliminates the footgun | ❌ type-coercion footguns; multiple emitters | ⚠️ attribute ordering; C14N exists |

### What format choice actually decides

Interpreting any artifact takes three steps:

1. **Get the bytes** — format-agnostic.
2. **Parse bytes into a generic structure** — differs only in *which* parser is needed, never *whether* one is.
3. **Interpret that structure as an exam** — requires a shared, schema-aware machine (dispatch on problem type, select a scoring function per rubric kind, resolve answer tokens). Required for *every* format; the counterparty must adopt our schema regardless.

Two myths fall out of this. Hashing (step-1-adjacent) never depended on format — see the R8 note. And "JSON parses everywhere" only wins step 2's *base layer*: a stock JSON parser yields a tree, not a verdict; step 3 is unavoidable in all cases. So format choice reduces to a narrow question: **which parser do we ask consumers to depend on, and how much of step 3's machinery does the format carry for them versus force them to rebuild?**

JSON's status as a *lossy projection target* depends on **which** JSON. A *bespoke* exam JSON (Appendix A) is lossy: identity/reuse collapses into `id` fields plus lookup, rubric kind into a `"kind"` discriminant, and the option pool is duplicated — real step-3 machinery every consumer rebuilds. But there is a second JSON: the **canonical `Pattern<Subject>` JSON** that `@relateby/pattern` produces from gram ([published schema](https://github.com/gram-data/tree-sitter-gram/blob/main/docs/pattern.schema.json)). That representation is *structure-preserving* — `identity`, `labels` (rubric-as-label), `properties`, and `elements` (stages, shared option pools by identity) survive intact. It is gram's structure rendered as ordinary JSON, not a flattening of it.

This collapses the tradeoff the earlier drafts agonized over. As of `@relateby/pattern` **0.6.0**, the pattern data model and its canonical JSON are a **zero-dependency, native-TypeScript** package, decoupled from the gram *notation codec* (`@relateby/gram` 0.6.0, which carries the tree-sitter/WASM grammar). So the WASM dependency lives only on the *authoring* side; a consumer that receives the canonical `Pattern<Subject>` JSON parses it with **stock JSON** — no WASM, no gram grammar.

### Recommendation (for discussion)

> *Author exams in gram (`.exam.gram`); commit the canonical `Pattern<Subject>` JSON as the artifact-of-record and hash target. Authoring keeps gram's ergonomics and native structure; the committed bytes are structure-preserving ordinary JSON that any party verifies and interprets with stock tools.*

This is no longer the "compromise that re-incurs the re-inflation tax" earlier drafts described — because the committed JSON is the canonical pattern serialization, the structure is *not* thrown away. It is close to strictly dominant: gram authoring (Q1/Q3/Q4/Q5) **and** a stock-JSON verification boundary (Q2), with WASM confined to authors who choose gram source.

#### Consumer model — who actually parses the bytes

Ghosts never parse exam artifacts. As with maps — a client sees a position and exits, never the `.map.gram` source — a ghost experiences an exam entirely through world-API tool calls (fetch the next problem, submit an answer), and the world server mediates. Designing those tools is out of scope here and orthogonal to the format choice.

That leaves three actual consumers of the bytes:

- **World server:** the only component that parses the artifact in the hot path — and it already runs the gram toolchain for `.map.gram`, so a gram-derived artifact adds no new runtime dependency *class*.
- **Exam authors:** write `.exam.gram` (build-time tooling); they never ship bytes to ghosts.
- **Auditors:** verify a revealed artifact after settlement. Because the committed bytes are canonical `Pattern<Subject>` JSON, an auditor needs only stock JSON + `shasum` — no gram or WASM (Appendix G.3).

So "what must a ghost install" was the wrong question — ghosts install nothing. The right questions are what the *server* commits and what an *auditor* can independently verify; canonical `Pattern<Subject>` JSON answers both.

**The contested choice is now narrower: the authoring surface.** Both gram and YAML beat JSON on authoring. gram wins in-repo fit (Q4) and — decisively, given the above — its canonical serialization *is* the structure-preserving committed JSON, so authoring and artifact-of-record share one model. YAML wins eval-ecosystem familiarity (lm-eval-harness, promptfoo), but its anchors collapse on parse and it has no structure-preserving canonical JSON, so a YAML→JSON pipeline lands back on the *bespoke* (lossy) exam JSON. That asymmetry now favors gram for the authoring slot more strongly than the pre-0.6.0 analysis suggested.

**QTI is a reference standard, not a fallback.** XML/QTI is rejected as our artifact-of-record purely on weight: its complexity dwarfs a broker exam and its tooling targets education platforms, not LLM agents. But its *design* shapes our schema regardless of the encoding we pick — the **Domain Reference** section maps exactly which parts we adopt (the item/response/processing separation = R3; section/test composition = R4), which we omit (delivery, accessibility, rendering), and which are ours alone (the contract envelope). Targeting a deliberate *subset* is what keeps QTI a guide rather than a payload; whether to make that subset round-trippable with real QTI tooling is Open Question 6.

Fallbacks for the artifact-of-record, in order of preference:

- **Bespoke exam JSON** (Appendix A), if adopting `@relateby/pattern` 0.6.0 (a 0.4→0.6 migration; see below) is judged not worth it now. Fully eligible; costs are authoring verbosity, option duplication, and the permanent re-inflation tax — tolerable at the broker's current scale. The minimal participation tier is identical (stock JSON either way); what is lost is the structure-preserving shape and gram authoring.
- **YAML authoring → bespoke exam JSON**, if eval-ecosystem familiarity outweighs gram's structural fit — but the committed JSON is the lossy one, and YAML's footguns (Q5) argue for committing JSON rather than YAML bytes.

**Dependency prerequisite.** The recommended path requires bumping `@relateby/pattern` from the project's pinned **0.4.x** to **0.6.0** (across the 0.5.x line) and adopting `@relateby/gram@0.6.0` for authoring. A pre-1.0 package that *split* between 0.4 and 0.6 likely carries breaking changes, so `shared/map-gram` and `server/world-api` need a migration spike, not a version bump. Crucially, the *consumer/evaluator* path needs no `@relateby/*` dependency at all (stock JSON), so the migration burden falls on the world server and exam authors, not on third-party agents.

This recommendation is explicitly open. The requirements and scenarios above are the part this RFC asks reviewers to ratify; the format choice — now leaning toward gram-authored, canonical-`Pattern<Subject>`-JSON-of-record — is the part it asks them to debate.

---

## Open Questions

1. **Parser dependency for the artifact-of-record — largely resolved.** Earlier drafts framed this as "commit gram source (forces `@relateby/pattern` on everyone) vs. commit lossy JSON." The `@relateby/pattern` **0.6.0** split resolves it: commit the **canonical `Pattern<Subject>` JSON** ([published schema](https://github.com/gram-data/tree-sitter-gram/blob/main/docs/pattern.schema.json)), which is structure-preserving and parseable with stock JSON — no WASM at the verification boundary (see Recommendation and the consumer model). The residual question is only whether to *also* publish the gram source alongside the canonical JSON for human readability, and which of the two (if any) the `artifactRef` should bind — they have different bytes and therefore different hashes.

2. **Answer-key granularity.** R3 gives a whole-exam prompt-only/full split. Should the format additionally support *per-problem* rubric disclosure (reveal the rubric for q1 without revealing q2's), via separate `disclosureRefs` entries?

3. **Multi-stage submission and verdict shape.** Each stage is a separately-hashed artifact (R4). Is there one submission per stage (each with its own `submissionHash`), or one concatenated submission? And does the single verdict pool all problems across stages with uniform weighting, or are stages themselves weighted? (See Appendix A/D S4 for the assumed default; this should be ratified.)

4. **Multi-select problem type.** The schema supports one-of-N. A choose-K-of-N variant is common in educational formats. Deferred until a concrete use case arises.

5. **Partial credit for exact-match and numerical.** Currently binary (1.0/0.0). GIFT's `%50%` notation shows weighted-correct answers are sometimes wanted; deferred.

6. **QTI-subset interoperability as a goal.** The Domain Reference treats QTI as a yardstick. A stronger commitment would make the chosen format *round-trip* to and from a QTI 3.0 subset, so exams authored in standard assessment tools could be imported and ours exported. That would justify mirroring QTI's element structure more literally — and would reweight the format choice itself (XML/QTI's appendix becomes more than a reference if interop is in scope). Is import/export with existing QTI tooling a product goal, or is QTI purely a design reference?

7. **Reconcile Appendix G with real `@relateby/pattern@0.6.0` output (implementation prerequisite).** The canonical `Pattern<Subject>` JSON in G.1/G.2 is reconstructed from the published schema and the `StandardGraph` conventions, not captured from the library. Before the artifact format is implemented, compile the Appendix D gram with the actual 0.6.0 codec and confirm: (a) how named vs. anonymous endpoints and grouping members serialize (identity-only stub vs. full subject); (b) the serializer's key ordering and whitespace (fixes the exact bytes that get hashed); (c) that `StandardGraph` round-trips the exam without loss. Then update G.1/G.2 to match byte-for-byte.

---

## Appendix A — JSON

A document with a `schema_version`, an `exam_id` (scopes all problem ids), an optional `stage` ordinal, and a `problems[]` array. Rubric is embedded per problem with a `kind` discriminant.

### A.S2 — Mixed exam, full artifact (with rubric)

```json
{
  "schema_version": "1",
  "exam_id": "01JXKP2W4BVKA3MN5QZGR7TDFE",
  "problems": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "prompt": "Which consensus algorithm is used by Bitcoin?",
      "weight": 2,
      "options": [
        { "id": "a", "text": "Proof of Work" },
        { "id": "b", "text": "Proof of Stake" },
        { "id": "c", "text": "Delegated Proof of Stake" },
        { "id": "d", "text": "Practical Byzantine Fault Tolerance" }
      ],
      "rubric": { "kind": "exact_match", "correct": ["a"] }
    },
    {
      "id": "q2",
      "type": "short_answer",
      "prompt": "Name the creator of Bitcoin.",
      "weight": 1,
      "rubric": { "kind": "exact_match", "correct": ["Satoshi Nakamoto"] }
    },
    {
      "id": "q3",
      "type": "open_ended",
      "prompt": "Explain why proof of work is energy-intensive.",
      "weight": 3,
      "rubric": {
        "kind": "model_graded",
        "criteria": "Score 1.0 if the response explains that miners compete to find a hash below a target and must perform many computations. 0.5 partial, 0.0 incorrect/empty.",
        "reference": "Miners repeatedly hash candidate blocks with different nonces until the output falls below the difficulty target; wasted work is the norm."
      }
    }
  ]
}
```

### A.S3 — Prompt-only artifact (rubric stripped; this is `artifactRef`)

Mechanically derived by deleting every `rubric` field:

```json
{
  "schema_version": "1",
  "exam_id": "01JXKP2W4BVKA3MN5QZGR7TDFE",
  "problems": [
    { "id": "q1", "type": "multiple_choice", "prompt": "Which consensus algorithm is used by Bitcoin?", "weight": 2,
      "options": [ { "id": "a", "text": "Proof of Work" }, { "id": "b", "text": "Proof of Stake" }, { "id": "c", "text": "Delegated Proof of Stake" }, { "id": "d", "text": "Practical Byzantine Fault Tolerance" } ] },
    { "id": "q2", "type": "short_answer", "prompt": "Name the creator of Bitcoin.", "weight": 1 },
    { "id": "q3", "type": "open_ended", "prompt": "Explain why proof of work is energy-intensive.", "weight": 3 }
  ]
}
```

Prompt-only and full share `exam_id` but differ in bytes and hash. The full artifact's hash is committed as a `disclosureRef`; after submission the client reveals it, and any party re-hashes to verify and confirms identity by matching `exam_id`.

### A.S2 — Submission

```json
{
  "schema_version": "1",
  "exam_id": "01JXKP2W4BVKA3MN5QZGR7TDFE",
  "answers": [
    { "problem_id": "q1", "value": "a" },
    { "problem_id": "q2", "value": "Satoshi Nakamoto" },
    { "problem_id": "q3", "value": "Mining requires guessing a nonce repeatedly until the block hash meets the difficulty target; most attempts are discarded, consuming electricity for no output." }
  ]
}
```

### A.S4 — Multi-stage

Each stage is a separate document sharing `exam_id`, distinguished by `stage`. Problem ids must be unique across all stages of one exam.

```json
{ "schema_version": "1", "exam_id": "01JXKP...", "stage": 1, "problems": [ { "id": "q1", "...": "..." } ] }
```
```json
{ "schema_version": "1", "exam_id": "01JXKP...", "stage": 2, "problems": [ { "id": "q4", "...": "..." } ] }
```

Each stage hashes independently and is committed as its own `disclosureRef`. *Assumed default (see Open Question 3):* the verdict pools all problems from all revealed stages into one `Σ(score·weight)/Σ(weight)`.

### Verdict derivation (shared by all eligible formats)

| Rubric kind | Per-problem score |
|---|---|
| `exact_match` | 1.0 if `value` ∈ `correct` (case-insensitive for `short_answer`), else 0.0 |
| `numerical` | 1.0 if `|value − correct| ≤ tolerance`, else 0.0 |
| `model_graded` | Evaluator LLM scores using `criteria` + optional `reference` |
| `human` | Human scores using `criteria` |
| absent (open_ended) | Evaluator scores at discretion |

`verdict = Σ(score_i × weight_i) / Σ(weight_i)`. One verdict per contract; the RFC-0022 settlement formula is unchanged. Per-problem scores are not recorded in the ledger.

### Assessment

- **R1–R8:** all satisfied. R3 prompt-only derivation is a mechanical field-strip; R4 staging works via the `stage` field but the cross-stage submission/verdict shape needs the convention in Open Question 3.
- **Strengths (Q2, Q4):** the base parser is ubiquitous and mature, and the format aligns with existing JSON configs. With a generator convention (sorted keys, no insignificant whitespace, UTF-8, no BOM) generation-time bytes are stable (Q5).
- **Weaknesses (Q1, Q3, and as a lossy target):** verbose and noisy to hand-author; no component reuse — the option pool in S2 must be duplicated if two problems share it; rubric kind is a `{ "kind": ... }` discriminant rather than intrinsic structure. A stock JSON parser yields a generic tree, not an exam — and because JSON is a lossy projection of a structured exam, the consumer's schema-aware layer must *rebuild* identity, reuse, and rubric dispatch from convention. That reconstruction is the "extra machinery," paid by every consumer.

---

## Appendix B — JSONL

One JSON object per line. A leading header line carries exam-level fields; each subsequent line is a problem. Grading is embedded per line (a deliberate deviation from OpenAI Evals JSONL, where grading is registered out-of-band).

### B.S2 — Mixed exam, full artifact

```jsonl
{"schema_version": "1", "exam_id": "01JXKP...", "kind": "exam_header", "stage": 1}
{"id": "q1", "type": "multiple_choice", "prompt": "Which consensus algorithm is used by Bitcoin?", "weight": 2, "options": [{"id":"a","text":"Proof of Work"},{"id":"b","text":"Proof of Stake"},{"id":"c","text":"Delegated PoS"},{"id":"d","text":"PBFT"}], "rubric": {"kind":"exact_match","correct":["a"]}}
{"id": "q2", "type": "short_answer", "prompt": "Name the creator of Bitcoin.", "weight": 1, "rubric": {"kind":"exact_match","correct":["Satoshi Nakamoto"]}}
{"id": "q3", "type": "open_ended", "prompt": "Explain why proof of work is energy-intensive.", "weight": 3, "rubric": {"kind":"model_graded","criteria":"..."}}
```

### B.S3 / B.S4

Prompt-only derivation = strip `rubric` from each line (same as JSON). **Staging (S4) is JSONL's one genuine win:** because each line is an independently meaningful record, a stage can be a contiguous slice of lines — or, more cleanly, each line can be hashed independently, giving per-problem `disclosureRefs` for free without an envelope. The submission mirrors the shape: one answer object per line.

### Assessment

- **R5 ⚠️:** satisfiable only by embedding the rubric per line, which is precisely the JSONL convention this departs from. What remains is "JSON objects separated by newlines" with weaker structure than a single JSON document.
- **R4 (disclosure granularity) bonus:** because each line is independently meaningful, a single line hashes on its own — giving per-problem `disclosureRefs` without an envelope. (This is a disclosure-granularity property, not a hashability one; every format hashes — see the R8 note.) A real but narrow advantage.
- **Weaknesses (Q3, and the envelope problem):** no container for exam-level fields, so `exam_id` either repeats on every line or lives in a magic header line; option pools still duplicate; composition is implicit in line adjacency. The streaming/append strengths that justify JSONL elsewhere don't matter for a small, fully-authored exam.
- **Verdict:** eligible but strictly worse than plain JSON for this use; its advantages are for high-volume eval *datasets*, not single contract artifacts.

---

## Appendix C — GIFT

Moodle's plain-text question DSL. Embeds correct answers inline with `=` (correct) / `~` (wrong), and `%N%` for partial credit. Human-authorable and educator-familiar.

### C.S2 — Mixed exam

```
::q1:: Which consensus algorithm is used by Bitcoin? {
  =Proof of Work
  ~Proof of Stake
  ~Delegated Proof of Stake
  ~PBFT
}

::q2:: Name the creator of Bitcoin. {
  =Satoshi Nakamoto
}

::q3:: Explain why proof of work is energy-intensive. {
}
```

GIFT's `::title::` is a *display title*, not a stable machine identifier — Moodle pairs answers positionally and treats the title as human-facing text. There is no contract that titles are unique or stable, and the format offers no per-problem weight syntax (weights are an LMS-level setting, not in the file) or model-graded rubric (the empty `{}` essay question carries no scoring criteria).

### Assessment

- **R2 ❌ (disqualifying):** no stable per-question identifier. Answer pairing is positional; this breaks under reordering and under staged reveals (R4 ❌). This is the structural blocker.
- **R3 ⚠️:** the correct answer is *inside* the question block (`=Proof of Work`), so a prompt-only view requires parsing each block and stripping `=`/`~`/`%N%` lines — derivable, but the format actively co-locates what we need to separate.
- **R5 ⚠️:** exact-match and numerical rubrics embed naturally; model-graded/human criteria and per-problem weights have no native syntax.
- **R8 ⚠️:** no canonical form (whitespace/quoting variation), though bytes still hash — same caveat as any text format.
- **Strengths (Q1):** best-in-class human authoring; the embedded-rubric and inline-partial-credit ideas directly inspire the eligible formats.
- **Verdict:** ineligible as the artifact-of-record; retained as authoring inspiration.

---

## Appendix D — gram

The project's hierarchical pattern notation (not a graph notation): structural composition with path-element sugar, a defined canonical serialization via `@relateby/pattern`, already used for `.map.gram`, `.character.gram`, and schedules.

### D.S2 / D.S4 — Mixed, staged exam

gram is graph-capable by *convention*, not by a dedicated edge type: `(a)-[:R]->(b)` is sugar for a `Pattern<Subject>` with two elements, `[:R | (a), (b)]`. `@relateby/pattern`'s [`StandardGraph`](https://github.com/relateby/pattern-rs/blob/main/typescript/packages/pattern/src/standard-graph.ts) reads the canonical JSON by `elements.length` — **0 = node, 2 = relationship (`[source, target]` by order), N = path** — and reconciles endpoint/member stubs with their full definitions by `identity` merge. So nodes, relationships (rubric-as-edge), and shared nodes (option-pool reuse) all round-trip into the committed JSON (Appendix G). This gram validates against `gram-lint`:

```gram
(opts:Options { a: "Proof of Work", b: "Proof of Stake", c: "Delegated Proof of Stake", d: "PBFT" })

(q1:Problem { type: "multiple_choice", prompt: "Which consensus algorithm is used by Bitcoin?", weight: 2 })
(q1)-[r1:ExactMatch { correct: ["a"] }]->(opts)

(q2:Problem { type: "short_answer", prompt: "Name the creator of Bitcoin.", weight: 1 })
(q2)-[r2:ExactMatch { correct: ["Satoshi Nakamoto"] }]->(:Text)

(q3:Problem { type: "open_ended", prompt: "Explain why proof of work is energy-intensive.", weight: 3 })
(q3)-[r3:ModelGraded { criteria: "Score 1.0 if competitive hashing is identified as the source of waste." }]->(:Text)

(q4:Problem { type: "numerical", prompt: "Estimate the annual TWh consumed by Bitcoin mining.", weight: 1 })
(q4)-[r4:Numerical { correct: 150, tolerance: 50 }]->(:Number)

[stage1:Stage { title: "Fundamentals" } | q1, q2, q3]
[stage2:Stage { title: "Applied" } | q4]

[exam:Exam { schema_version: "1", exam_id: "01JXKP2W4BVKA3MN5QZGR7TDFE" } | stage1, stage2]
```

Problems are nodes; each rubric is a relationship from its problem to its answer-space (the shared `opts` pool, or an anonymous `Text` / `Number` node) carrying the scoring parameters on the edge; `Stage` and `Exam` are grouping patterns composing their members by reference.

### D.S3 — Prompt-only view

Derived by **dropping the rubric relationships** (`r1`…`r4`) — the patterns whose subject label is a rubric kind — and keeping the `Problem` nodes, the `Options` pool, and the `Stage` / `Exam` groupings. Because the rubric is a distinct relationship rather than a field on the problem, removing answer material is a clean structural cut.

### Assessment

- **R1–R8:** all satisfied. R2 ids are subject identifiers (`q1`…`q4`), stable across views and stages. R3 separation is structural (rubric is a separate relationship). R4 staging is native composition.
- **Strengths (Q1, Q3, Q4, Q5):**
  - **Rubric-as-relationship** — `:ExactMatch`, `:ModelGraded`, `:Numerical` — the relationship's label *is* the rubric kind, parameters as edge properties; no `{ "kind": ... }` discriminant. It survives serialization as a 2-element Pattern.
  - **Option reuse by identity** — `opts` is defined once and referenced as an endpoint by any number of rubric relationships; `StandardGraph` merges by identity, so reuse is preserved in the committed JSON (it is *not* inlined — the contrast with a YAML anchor, which expands to a full copy).
  - **Stage composition** — the same `[group | members]` pattern used by maps and schedules; progressive disclosure maps onto the `Stage` grouping.
  - **Structure-preserving JSON** — `@relateby/pattern` emits canonical `Pattern<Subject>` JSON ([published schema](https://github.com/gram-data/tree-sitter-gram/blob/main/docs/pattern.schema.json)) preserving `identity` / `labels` / `properties` / `elements`, so the committed bytes keep nodes, relationships, and groupings on a stock-JSON verification boundary (Appendix G).
- **Weaknesses (Q2 maturity/ubiquity) — narrower than they appear.** As of **0.6.0** the dependency splits cleanly: *consuming* the canonical `Pattern<Subject>` JSON needs only **stock JSON** (or the zero-dep, native-TS `@relateby/pattern`), while *authoring* `.exam.gram` source needs `@relateby/gram` (tree-sitter/WASM). The genuine residual cost is pre-1.0 maturity: the project is pinned at `0.4.x`, and adopting the canonical JSON requires a `0.4 → 0.6` migration of `shared/map-gram` and `server/world-api` (the package split implies breaking changes).
- **Verdict:** strongest eligible format on quality, and — once the committed bytes are the canonical `Pattern<Subject>` JSON rather than gram source — the parser-at-the-boundary weakness evaporates (the only hot-path parser is the world server, which already runs the gram toolchain for maps). The remaining cost is the upstream version migration, not a per-consumer tax.

---

## Appendix E — YAML

YAML shares JSON's data model, so the schema is identical (`schema_version`, `exam_id`, optional `stage`, `problems[]`, per-problem `rubric`). What changes is the authoring experience: less punctuation, comments, and **anchors/aliases** (`&name` / `*name`) for reuse.

### E.S2 — Mixed exam, full artifact (with reuse via anchors)

```yaml
schema_version: "1"
exam_id: "01JXKP2W4BVKA3MN5QZGR7TDFE"   # quote it — see footgun note
problems:
  - id: q1
    type: multiple_choice
    prompt: Which consensus algorithm is used by Bitcoin?
    weight: 2
    options: &consensus_pool      # define the option pool once
      - { id: a, text: Proof of Work }
      - { id: b, text: Proof of Stake }
      - { id: c, text: Delegated Proof of Stake }
      - { id: d, text: PBFT }
    rubric: { kind: exact_match, correct: ["a"] }
  - id: q2
    type: multiple_choice
    prompt: Which of those is the most energy-intensive?
    weight: 1
    options: *consensus_pool       # reuse it — impossible in plain JSON
    rubric: { kind: exact_match, correct: ["a"] }
  - id: q3
    type: open_ended
    prompt: Explain why proof of work is energy-intensive.
    weight: 3
    rubric:
      kind: model_graded
      criteria: Score 1.0 if competitive hashing is identified as the source of waste.
```

### E.S3 / E.S4

Prompt-only derivation is the same field-strip as JSON (delete `rubric:` keys). Staging (S4) uses a `stage:` field as in JSON — or YAML's native **multi-document stream** (`---` separators), where each stage is one document sharing `exam_id`. Submissions mirror the JSON shape.

### Assessment

- **R1–R8:** all satisfied — YAML is a JSON-equivalent data model, so eligibility tracks Appendix A exactly.
- **Strengths (Q1, Q3, Q4):** the best pure *authoring* surface of the JSON family — comments, terse syntax, and anchors that give genuine option reuse (`*consensus_pool`). Decisively, it is the format the LLM-eval ecosystem already speaks (lm-eval-harness, promptfoo) — real domain familiarity that gram and JSON lack.
- **Weaknesses (Q5, and the same lossy-target tax as JSON):**
  - **Type-coercion footguns.** Unquoted scalars are silently coerced: the "Norway problem" (`no`, `off`, `yes` → booleans), version-like strings (`1.10` → number), and times/dates. An answer key of `correct: [no]` becomes `[false]`. This makes YAML both the least byte-stable candidate *and* a latent correctness hazard unless every scalar is quoted — and "quote everything" erodes the authoring advantage.
  - **Anchors collapse on parse.** `*consensus_pool` expands to a full copy in the parsed tree, so the reuse is an authoring convenience, not preserved structure — it vanishes on any round-trip to JSON.
  - **Lossy tree, like JSON.** Step 3 (schema-aware interpretation) and the re-inflation of identity/rubric-dispatch are unchanged from Appendix A.
- **Verdict:** the strongest *authoring* contender; pairs naturally with a compiled-JSON commit to neutralize the footguns. Its claim against gram is Q4 eval-domain familiarity versus gram's in-repo fit and native structure.

---

## Appendix F — XML / QTI 3.0

[QTI 3.0](https://www.imsglobal.org/spec/qti/v3p0/oview) (1EdTech, final 2022) is the assessment-interchange standard. It is structurally richer than everything above: an **item** separates the prompt (`qti-item-body`) from the answer key (`qti-response-declaration`) from the scoring (`qti-response-processing`); **tests** compose **sections** of item references with native sequencing. Namespaces and some attributes are trimmed below for readability.

### F.S2 — A single item (multiple choice)

```xml
<qti-assessment-item identifier="q1" title="Bitcoin consensus">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response>
      <qti-value>a</qti-value>            <!-- answer key — a separate element -->
    </qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>

  <qti-item-body>                          <!-- the prompt-only view lives here -->
    <p>Which consensus algorithm is used by Bitcoin?</p>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="a">Proof of Work</qti-simple-choice>
      <qti-simple-choice identifier="b">Proof of Stake</qti-simple-choice>
      <qti-simple-choice identifier="c">Delegated Proof of Stake</qti-simple-choice>
      <qti-simple-choice identifier="d">PBFT</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>

  <qti-response-processing                 <!-- scoring; a stock template by URL -->
    template="https://www.imsglobal.org/question/qti_v3p0/rptemplates/match_correct"/>
</qti-assessment-item>
```

### F.S4 — A test composing staged sections

```xml
<qti-assessment-test identifier="cryptic-currency">
  <qti-test-part identifier="part1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="stage1" title="Fundamentals" visible="true">
      <qti-assessment-item-ref identifier="q1" href="q1.xml"/>
      <qti-assessment-item-ref identifier="q2" href="q2.xml"/>
    </qti-assessment-section>
    <qti-assessment-section identifier="stage2" title="Applied" visible="true">
      <qti-assessment-item-ref identifier="q4" href="q4.xml"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>
```

### Assessment

- **R1–R8: all satisfied, several structurally.** R3 is *native* — `qti-item-body` (prompt), `qti-response-declaration` (key), and `qti-response-processing` (scoring) are distinct elements, so a prompt-only view is "ship the item body without the response declaration/processing," no field-stripping heuristic. R4 is *native* — sections, test parts, sequencing, and even adaptive testing. R2 uses `identifier` attributes throughout.
- **R5 caveat:** scoring via a stock `qti-response-processing` *template* is referenced by a well-known URL — technically an external reference, though its semantics are standardized. Fully self-contained scoring requires inlining custom `qti-response-processing` rules.
- **Strengths (Q3, + reference value):** native item/section/test composition, reusable response-processing templates, first-class identifiers and references, accessibility, adaptive testing. It is the assessment field's interoperability standard — maximal reference value, and the source of the R3/R4 design this RFC's requirements already echo.
- **Weaknesses (Q1, Q4, Q2 at the schema layer):** very verbose and heavy to hand-author; namespaces and a large normative schema; tooling is education-LMS-oriented, not the LLM-agent stack; the capability surplus over a broker exam is enormous.
- **Verdict:** ineligible-in-practice as *our* artifact-of-record — rejected on weight and ecosystem mismatch, not capability (it is the most capable candidate by far). Retained as the **reference standard**: its body/response/processing separation and section model shape our schema in whichever format we adopt. The **Domain Reference** section maps the precise subset we take versus the delivery surface we leave behind; if Open Question 6 (QTI round-trip interop) is answered "yes," this appendix is promoted from reference to interop target.

---

## Appendix G — Canonical artifact-of-record and demo

The recommended artifact-of-record is the **canonical `Pattern<Subject>` JSON** that `@relateby/pattern` emits from the Appendix D gram. The document is a top-level array of patterns; each pattern is `{ subject: { identity, labels, properties }, elements: [...] }`. Per [`StandardGraph`](https://github.com/relateby/pattern-rs/blob/main/typescript/packages/pattern/src/standard-graph.ts), `elements.length` classifies a pattern — **0 = node, 2 = relationship (`[source, target]` by order), N = grouping/path** — and endpoints/members appear as identity-stubs reconciled with their full definitions by identity merge. (Exact key order and whitespace are the serializer's to define; per the R8 note, the committed bytes are hashed as-is — no byte-canonicalization is required.)

> **Implementation flag.** The JSON in G.1/G.2 is a *faithful reconstruction* from the published schema plus the `StandardGraph` rules — specifically the choices to render endpoints/members as identity-only stubs (`labels: []`, `properties: {}`) and to serialize multi-member groupings the same way. It has **not** been captured from `@relateby/pattern@0.6.0` output. Before implementation, run the Appendix D gram through the actual 0.6.0 serializer and reconcile these examples byte-for-byte. See Open Question 7.

### G.1 — Full artifact-of-record (excerpt)

Showing `q1` (a multiple-choice problem), its shared option pool, its rubric relationship, and the `Stage` / `Exam` groupings. `q2`–`q4` and their rubric relationships follow the identical node + relationship shape.

```json
[
  { "subject": { "identity": "opts", "labels": ["Options"],
      "properties": { "a": "Proof of Work", "b": "Proof of Stake", "c": "Delegated Proof of Stake", "d": "PBFT" } },
    "elements": [] },

  { "subject": { "identity": "q1", "labels": ["Problem"],
      "properties": { "type": "multiple_choice", "prompt": "Which consensus algorithm is used by Bitcoin?", "weight": 2 } },
    "elements": [] },

  { "subject": { "identity": "r1", "labels": ["ExactMatch"], "properties": { "correct": ["a"] } },
    "elements": [
      { "subject": { "identity": "q1", "labels": [], "properties": {} }, "elements": [] },
      { "subject": { "identity": "opts", "labels": [], "properties": {} }, "elements": [] }
    ] },

  { "subject": { "identity": "stage1", "labels": ["Stage"], "properties": { "title": "Fundamentals" } },
    "elements": [
      { "subject": { "identity": "q1", "labels": [], "properties": {} }, "elements": [] },
      { "subject": { "identity": "q2", "labels": [], "properties": {} }, "elements": [] },
      { "subject": { "identity": "q3", "labels": [], "properties": {} }, "elements": [] }
    ] },

  { "subject": { "identity": "exam", "labels": ["Exam"],
      "properties": { "schema_version": "1", "exam_id": "01JXKP2W4BVKA3MN5QZGR7TDFE" } },
    "elements": [
      { "subject": { "identity": "stage1", "labels": [], "properties": {} }, "elements": [] },
      { "subject": { "identity": "stage2", "labels": [], "properties": {} }, "elements": [] }
    ] }
]
```

`r1` is the rubric: a 2-element relationship from `q1` to `opts`, label `ExactMatch`, scoring parameters on the subject. `opts` is defined once as a full node and referenced elsewhere by identity-stub — the reuse `StandardGraph` reconstructs by merge.

### G.2 — Prompt-only artifact (this is the `artifactRef`)

Drop the rubric relationships (`r1`…`r4`); keep the problem nodes, the option pool, and the groupings:

```json
[
  { "subject": { "identity": "opts", "labels": ["Options"],
      "properties": { "a": "Proof of Work", "b": "Proof of Stake", "c": "Delegated Proof of Stake", "d": "PBFT" } },
    "elements": [] },
  { "subject": { "identity": "q1", "labels": ["Problem"],
      "properties": { "type": "multiple_choice", "prompt": "Which consensus algorithm is used by Bitcoin?", "weight": 2 } },
    "elements": [] },
  { "subject": { "identity": "stage1", "labels": ["Stage"], "properties": { "title": "Fundamentals" } },
    "elements": [ "…q1, q2, q3 stubs…" ] },
  { "subject": { "identity": "exam", "labels": ["Exam"],
      "properties": { "schema_version": "1", "exam_id": "01JXKP2W4BVKA3MN5QZGR7TDFE" } },
    "elements": [ "…stage1, stage2 stubs…" ] }
]
```

Same `exam_id`, but every rubric relationship is absent, so this exposes no answer key. Its hash is the `artifactRef`; the full G.1 hash is committed as a `disclosureRef`.

### G.3 — Demo (≈15 min; gram toolchain + `shasum`)

Audience: an exam author or auditor — **not** a ghost (ghosts interact only through world-API tools; see the consumer model).

1. **Author** `cryptic-currency.exam.gram` from Appendix D, then validate: `gram-lint cryptic-currency.exam.gram`.
2. **Compile** to canonical JSON with `@relateby/gram` + `@relateby/pattern` → `exam.full.json` (this is what the world server does at publish time).
3. **Derive prompt-only**: drop the rubric-labelled relationship patterns → `exam.prompt.json`.
4. **Commit**: `shasum -a 256 exam.prompt.json` → `artifactRef`; `shasum -a 256 exam.full.json` → `disclosureRef`. Confirm the two hashes differ. These are the values the world-API records on the ledger (RFC-0022 / RFC-0023).
5. **Take the exam** *(out of scope)* — a contractor ghost fetches problems and submits answers via world-API tools; the bytes never leave the server.
6. **Audit**: after settlement the world-API reveals `exam.full.json`. Re-run `shasum -a 256` and confirm it matches the committed `disclosureRef`, and that its `exam` subject's `exam_id` matches the prompt-only artifact. Verifiable with stock `shasum` + stock JSON — no gram or WASM.

This exercises R3 (prompt-only vs. full), R8 (independent hash verification), and the RFC-0022 commit-reveal end to end — without any consumer parsing gram.
