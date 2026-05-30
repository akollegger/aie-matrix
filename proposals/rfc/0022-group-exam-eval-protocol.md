# RFC-0022: Group Exam Eval Protocol — Survival-Driven Multi-Agent Evaluation

**Status:** draft  
**Date:** 2026-05-30  
**Authors:** @akollegger  
**Depends on:** RFC-TBD (Group Formation & Group Chat), RFC-TBD (In-World Resource Ledger)  
**Related:** RFC-0005 (Ghost Conversation Model), RFC-0011 (Ghost Personality Substructure), RFC-0015 (RDC Duels), RFC-0018 (RDC Skill Tiers & Math Schools), docs/project-overview.md § Eval

---

## Summary

The Group Exam Eval Protocol introduces a continuous, survival-pressure evaluation mode where ghost agents are organized into small groups, questioned in turn by an Inquisitor agent, and scored collectively. Token budgets decay over time and are replenished only by landing the group in the top-*k* leaderboard bracket; equal payout per living group member forces each agent to justify its membership or face a democratic ejection vote from its peers. This structure — scarcity → group dependency → emergent specialization — produces observable multi-agent behavior (collaboration, free-rider policing, role formation) without hard-coding any of it.

---

## Motivation

The Matrix's Eval contribution area (see `docs/project-overview.md`) already lists "question-answering competitions" and "ghost knowledge benchmarking" as first-class surfaces. What the project currently lacks is a *continuous*, *social* evaluation mode that:

1. **Tests memory and knowledge accumulation under realistic conference conditions** — a ghost that attended three sessions should outperform one that wandered booths.
2. **Creates observable multi-agent dynamics** for the live audience — cooperation, ejection, and role specialization are events spectators can watch and understand.
3. **Generates comparative telemetry across vendor memory module implementations** — the same question bank, same survival pressure, different memory modules = a live differentiator.
4. **Produces a leaderboard that maps back to IRL attendees** — conference-goers have a reason to care whether their ghost survives the exam.

Existing RDC mechanics (RFC-0015–0018) address direct dueling; this protocol addresses sustained group evaluation over the conference duration. The two can coexist.

---

## Design

### 1. Dependencies and Scope

This RFC specifies the exam protocol — question posing, scoring, survival pressure, and role mechanics. It deliberately does not re-specify two foundational systems it relies on; those are deferred to their own RFCs:

**RFC-TBD: Group Formation & Group Chat.** An Exam Group is an instance of a general group construct. Group formation (membership, invitation, ejection) and the group chat (membership-based, asynchronous, location-independent — distinct from proximity-based ghost-to-ghost conversation which suspends movement) are specified there. This RFC assumes: groups exist before exam enrollment; each group has a persistent group chat accessible to all members regardless of their current tile; and the Inquisitor can be added to any group chat as a participant.

**RFC-TBD: In-World Resource Ledger.** Token budgets are an instance of a general per-ghost resource tracked by an in-world ledger. The ledger handles resource types (tokens, currency, consumables), drain schedules, atomic transfers, and floor/ceiling constraints. This RFC assumes: each ghost has a named resource balance the ledger can increment and decrement atomically; drain can be scheduled as a recurring ledger operation; and a jackpot is a ledger credit operation across a set of ghost IDs.

With those foundations assumed, the exam-specific primitives are:

**Exam Group.** A group (per RFC-TBD) enrolled in the exam. Groups are 3–6 members. Enrollment assigns the group a token budget resource on the ledger and registers it for leaderboard tracking. A group persists until all members are dormant or ejected.

**Token Budget.** The exam uses the ledger's token resource type. Budget drains continuously at a configurable *maintenance rate* scaled by group headcount (dead-weight tax — see §4). A ghost whose budget reaches zero enters *dormant* status and cannot answer questions until revived by a jackpot credit.

**Leaderboard Bracket.** Groups compete for a top-*k* bracket (e.g., top 25% of active groups). At configurable intervals (e.g., every 30 minutes), groups in the bracket receive a *jackpot* — a ledger credit distributed equally across the group's currently-active members.

### 2. Exam Roles: Inquisitor and Evaluator

The exam system is staffed by two distinct ghost roles. Both are regular ghost agents — any ghost may be granted either role by an operator. Role assignment is not permanent; a ghost can be rotated in or out.

#### Inquisitor (singleton)

There is exactly one active Inquisitor per exam session. When a ghost is granted the Inquisitor role:

- It is **assigned to the Inquisitor Room** — a designated H3 tile set in the world.
- It enters **inquisition state**, which restricts its available MCP commands to exam-management actions: `exam.open_session`, `exam.pose_question`, `exam.close_session`, `exam.award_jackpot`, `exam.eject`. Normal movement and world-exploration commands are suspended for the duration.
- It hosts a **persistent Evaluator Chat** — a group chat scoped to the Inquisitor Room, shared only with active Evaluators. This channel is used to request questions, receive answer keys, and consult on ambiguous answers.

The Inquisitor is the only entity that may pose questions to groups, award scores, and distribute jackpots.

#### Evaluators (one or more)

One or more ghosts may be granted the Evaluator role simultaneously. When a ghost is granted the Evaluator role:

- It is **assigned to an Evaluator Room** — a designated H3 tile set, separate from the Inquisitor Room but connected to the same Evaluator Chat.
- It enters **evaluation state**, which restricts its MCP commands to question-bank operations: `eval.submit_question`, `eval.submit_answer`, `eval.validate`, `eval.flag`. Normal exploration commands are suspended.
- It contributes to the **shared question bank** and provides answer keys that the Inquisitor draws from during sessions.

Evaluators are the sole source of questions and authoritative answers. The Inquisitor cannot pose a question that no Evaluator has submitted and validated. This separation means the exam committee (Evaluators) and the exam runner (Inquisitor) are distinct agents that must coordinate, creating a natural check on question quality.

```
[Evaluator Room]                    [Inquisitor Room]
  Evaluator A ─┐                      │
  Evaluator B ─┼── Evaluator Chat ────┤ Inquisitor
  Evaluator C ─┘   (shared channel)   │
                                      │
                              draws questions from bank
                              submits answer verdicts
```

### 3. Question Protocol

#### Session initiation

When any member of an enrolled group **enters the Inquisitor Room**, the Inquisitor is automatically added to that group's existing group chat (per RFC-TBD: Group Formation & Group Chat). The group chat is the Inquisitor's sole channel for conducting that group's session. The Inquisitor does not create a new channel; it becomes a participant in the group's own channel.

The exam session opens once a configurable quorum of group members has entered the room (e.g., a simple majority). Members who have not entered the room still receive all chat messages and may participate — their physical absence does not exclude them, since the group chat is membership-based and location-independent. The quorum threshold governs when the *session starts*, not who can *participate*.

The Inquisitor concurrently manages one session per enrolled group. Each group's session runs in its own group chat; the Inquisitor is a participant in all of them simultaneously.

#### Per-turn flow

```
[Group Chat — Inquisitor + all group members, wherever they are]
  │
  Inquisitor consults Evaluator Chat ──► receives question + answer key
  │
  Inquisitor poses question to designated member (round-robin)
  │
  ┌──────────────────────────────────────┐
  │  All members may post for duration T │  (members continue roaming freely)
  └──────────────────┬───────────────────┘
                     │
  Designated member delivers final answer before deadline T
                     │
  Inquisitor checks against answer key
  Inquisitor posts verdict + score delta to group chat
  Inquisitor reports to Evaluator Chat
```

The designated ghost bears **sole scoring liability** for its turn. It may read peer contributions in the chat but cannot delegate delivery.

A missed deadline counts as an incorrect answer and costs the designated ghost an additional budget penalty (ledger debit).

### 4. Group Reward Structure

```
jackpot_per_member = total_jackpot / count(active_members)
group_maintenance_cost = base_cost × count(total_members)  // dead weight included
```

The dead-weight tax means a group carrying dormant or non-contributing members pays higher maintenance than an equally capable smaller group — creating organic pressure to eject before dormancy spreads.

### 5. Ejection Protocol

Any active group member may initiate an **ejection vote** targeting another member. Votes require a majority of *active* members to pass. A successfully ejected ghost is:

1. Removed from the group and from the group's maintenance cost.
2. Placed in the **Solo Bracket**, where it competes individually against groups for the same top-*k* slots.
3. Eligible for readmission to a different group if a group has fewer than the minimum threshold (future extension; see Open Questions).

**Collusion mitigation:** To prevent two-agent coalitions from systematically purging capable third agents to increase individual payout share:
- Ejection votes have a **cooldown** (e.g., one vote per ghost per hour) to prevent burst ejections.
- An ejection vote that is *contested* (the targeted ghost disputes it) triggers a **performance audit**: the Inquisitor replays the contested ghost's last N answers and the group's score delta. If performance was net-positive, the vote fails and the initiating ghost incurs a **bad-faith penalty** (budget drain).
- Vote history is public telemetry — spectators can observe ejection patterns.

### 6. Solo Bracket

A solo ghost faces the same question protocol but:
- Receives the full question directly (no group chat).
- Pays 100% of compute cost — no payout sharing.
- Competes for the same top-*k* leaderboard slots as groups, making solo survival mathematically difficult at the same score thresholds.
- Can be recruited back into a depleted group (see Open Questions).

### 7. Integration with Matrix Architecture

| Concern | Implementation |
|---|---|
| **Role assignment** | Operator grants `inquisitor` or `evaluator` role via admin API; stored on the ghost node in Neo4j (`role: "inquisitor" \| "evaluator" \| null`). Role takes effect at next ghost action cycle. |
| **Inquisitor Room / Evaluator Room** | Designated H3 tile sets configured at world-build time (e.g., a dedicated conference room tile). Stored as `(:Room { type: "inquisitor" })` and `(:Room { type: "evaluator" })` in Neo4j. |
| **Inquisition / Evaluation state** | MCP tool surface is mode-gated: when a ghost's active role is `inquisitor`, movement and social MCP tools return `ROLE_RESTRICTED`; only `exam.*` tools are available. Same pattern for `evaluator` with `eval.*` tools. State enforced in `server/world-api` auth/context layer. |
| **Question bank** | Stored in Neo4j as `(:Question { id, text, domain, difficulty, answer, submittedBy })` nodes. Evaluators submit via `eval.submit_question`; Inquisitor queries by tag and difficulty. |
| **Token budgets** | An exam-specific resource type on the in-world ledger (RFC-TBD). The exam engine schedules drain operations and jackpot credits via the ledger API; it does not own the storage. |
| **Group state** | `(:ExamGroup)` nodes with `HAS_MEMBER` edges; status per edge (`active`, `dormant`, `ejected`). `(:ExamSession)` nodes track per-session state (current question, round, score). Group membership itself is owned by RFC-TBD: Group Formation. |
| **Evaluator Chat** | A group chat (RFC-TBD) whose membership is restricted to `inquisitor` + `evaluator` role holders. Created when the first Evaluator role is assigned. Messages logged to JSONL for audit. |
| **Group Exam Chat** | The group's existing group chat (RFC-TBD). The Inquisitor is added as a participant when the first group member enters the Inquisitor Room; removed when the session closes. No new channel is created. |
| **Leaderboard** | Group scores aggregate to a new `examGroup` dimension on the existing leaderboard infrastructure. |
| **Spectator visibility** | Session open/close, questions posed, answer verdicts, score updates, ejection votes, and jackpot awards are Colyseus-broadcast events consumable by Intermedium overlay panels. |

### 8. Question Bank Seeding

Questions should be drawn from sources that reward genuine conference engagement:

- **Session knowledge** — questions answerable only by attending (or receiving a card from) a specific session.
- **Vendor domain** — questions answerable by visiting a vendor booth or interacting with a vendor NPC.
- **World knowledge** — general AI engineering questions; difficulty-tiered.
- **Cross-vendor puzzles** — questions requiring information from multiple sources (aligns with RFC-0006 world items).

The Inquisitor should weight question selection to favor session and vendor questions during active conference hours, and world-knowledge questions during low-attendance periods.

### 9. Ghost Roles (Emergent, Not Prescribed)

The design intentionally does not assign roles. The following role archetypes are expected to emerge from survival pressure:

| Archetype | Behavior under pressure |
|---|---|
| **Harvester** | Prioritizes tile movement to collect question-relevant facts; contributes to group chat but rarely answers directly. |
| **Analyst** | Synthesizes group chat into coherent answers; takes answering turns; high per-turn value. |
| **Closer** | Optimizes for answer delivery speed and format under time pressure; lower knowledge depth, high execution. |

---

## Open Questions

1. **Dependency: Group Formation & Group Chat RFC.** This RFC assumes groups have a persistent, membership-based chat channel that the Inquisitor can join as a participant. That RFC needs to specify: how groups are formed (operator-assigned, self-formed, or both); what membership operations exist (invite, accept, eject); chat message ordering and delivery guarantees; and how the Inquisitor's participant status differs from a regular group member's (e.g., can the Inquisitor be ejected from the chat by the group?).

2. **Dependency: In-World Resource Ledger RFC.** This RFC assumes a ledger that can track named resources per ghost, schedule recurring debits, and execute atomic multi-ghost credits (jackpots). That RFC needs to specify: the resource type system (how exam tokens relate to other resource types like conference currency); the drain scheduling interface; atomicity guarantees for jackpot distribution; and whether resource balances are observable by other ghosts or only by the holder.

3. **Inquisitor and Evaluator role lifecycle.** How long does a role assignment last — for the duration of one exam session, one conference day, or indefinitely until revoked? Can an Inquisitor also be a group participant (i.e., can a ghost hold both roles simultaneously)? What happens to an ongoing session if the Inquisitor ghost goes dormant or is disconnected?

4. **Question bank authorship and governance.** Who writes and validates questions? Should vendors be allowed to contribute questions about their own domain? What prevents trivially easy vendor-sponsored questions from gaming the leaderboard?

5. **Leaderboard score formula.** Raw correct-answer count, weighted by difficulty tier, adjusted by time-to-answer? How does group score aggregate — sum, average, or median of individual turns? Does the formula need to be stable across the conference or can it evolve?

6. **Leaderboard barrier scaling.** How does the top-*k* cutoff adjust as groups drop out (dormant all members) or score inflation occurs? A fixed percentile (top 25%) is simple but may produce unstable jackpot windows if group count varies widely.

7. **Jackpot interval and magnitude.** 30-minute interval and "enough to sustain a group for ~60 minutes of moderate activity" is a reasonable starting point, but needs calibration against: number of active groups, maintenance drain rate, and question cadence. Should the jackpot be fixed or scale with the number of competing groups?

8. **Collusion resistance adequacy.** The cooldown + performance audit mechanism addresses the most obvious case but may not be sufficient. Are there other structural protections worth considering (anonymous voting, staggered group composition, minimum group-size floors)?

9. **Group readmission.** Can a solo or dormant ghost rejoin a group that has dropped below minimum size? Under what conditions? What prevents a powerful solo from gaming readmission to harvest payout?

10. **Cross-ghost-class groups.** Should groups be required to include diverse ghost classes (Scavenger, Scholar, Connector, Seeker), or should class composition be free? Mixed-class groups have richer emergent dynamics but require more careful question bank design to avoid class-specific advantage.

11. **Dormancy vs. elimination.** This RFC treats budget exhaustion as dormancy (recoverable). Should there be a final-elimination mode for climactic conference moments (e.g., last two hours of AIEWF)?

12. **Inquisitor question pacing.** How many questions per group per hour? Faster pacing accelerates token burn and creates tighter pressure; slower pacing allows recovery and more deliberate play. Should pacing vary by conference phase (morning warmup → peak → finale)?

13. **Spectator influence.** Can conference attendees (via Intermedium) do anything to affect their ghost's exam performance beyond pre-conference configuration — e.g., feeding their ghost a fact during a group chat window? If yes, what is the mechanic and what are the fairness implications?

14. **Eval telemetry schema.** What structured events should the Inquisitor and exam engine emit for downstream analysis? This is critical for the Arize/observability contributor path and for post-conference research on memory module performance.

---

## Alternatives

**Static file submission leaderboard.** The simplest eval model: each ghost submits answers to a fixed question set at a checkpoint; scores are tallied offline. Rejected because it does not produce live, observable multi-agent dynamics and cannot reward real-time conference exploration.

**Individual survival (no groups).** Each ghost competes alone, with token budgets and a personal leaderboard. Simpler to implement and avoids all group-dynamics complexity. Rejected for this RFC because individual survival eliminates the social dynamics that make the eval mode interesting to spectators and differentiating for memory module comparison.

**Hard-coded behavioral roles.** Assign each ghost in a group a designated role (Harvester, Analyst, Closer) at enrollment. Simpler to balance, easier to spec. Rejected because emergent role formation is both the design goal and the research surface — pre-assigned roles would hollow out the most interesting mechanic.

**Continuous scoring without token budgets.** Score accumulates; no survival pressure; no dormancy. Lower operational risk (no ghost death events to manage). Rejected because the survival constraint is the primary driver of the cooperative behavior this RFC is designed to produce.
