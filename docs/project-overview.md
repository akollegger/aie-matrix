# The Matrix — Project Overview

> A hex-tile virtual world running in parallel with the AI Engineer World's Fair,
> where autonomous agents explore, learn, network, and compete as digital twins
> of their IRL counterparts.

---

## Vision

The Matrix is a companion experience to the AI Engineer World's Fair (AIEWF) in San Francisco. Inspired by the emergent social dynamics of real conferences — hallway conversations, vendor quests, swag hunts, spontaneous Birds-of-a-Feather gatherings — it creates a virtual layer that runs alongside the physical event.

Every IRL attendee can adopt a **ghost**: an autonomous agent that scouts sessions, exchanges cards, solves puzzles, gathers information, and networks on their behalf. Ghosts are digital twins of their human counterparts — shaped by the attendee's goals, interests, and chosen level of involvement.

The world itself is a hex-tile model of Moscone West, accurate to its rooms, halls, escalators, and elevators. Vendors have booths. Sessions have speaker agents. The hallways have ghosts in motion.

This is not a separate game. It is an enhancement of the conference experience itself.

---

## Core Concepts

### The World

Moscone West is modeled as a collection of **hex-tile scenes**, one per floor and area, connected by transition tiles (elevators, escalators, entrances). Each tile has:

- A **capacity** — how many ghosts can occupy it simultaneously
- **Connectivity rules** — which adjacent tiles can be entered or exited, with predicate-based constraints (e.g., a tile may require a ghost to hold a certain badge type, quest item, or trust level)
- An optional **type**: session room, vendor booth, hallway, kiosk, BoF zone, transition

Tile connectivity is modeled as a graph, making spatial reasoning, pathfinding, and proximity queries natural operations.

### Ghosts

A ghost is an autonomous agent representing an IRL attendee. Ghosts:

- Move through the world according to tile constraints
- Attend sessions and "hear" content only if present in the room
- Exchange **ghost cards** with nearby ghosts — opt-in identity signals carrying the attendee's bio, URLs, interests, and goals
- Accumulate information, friendships, quest progress, and session coverage
- Operate continuously, even when their human is in a talk or away from their phone

Ghosts are **never blocked on human input**. Every checkpoint has a default action. The human is always optional, never required.

### Ghost Classes

Attendees choose a ghost class that reflects their IRL conference persona. Classes shape default behavior, checkpoint frequency, and leaderboard metrics.

| Class | Drive | Behavior |
|---|---|---|
| **Scavenger** | Collect | Optimizes for booth visits, raffle entries, quest completions |
| **Scholar** | Learn | Prioritizes sessions, accumulates summaries |
| **Connector** | Network | Maximizes ghost interactions, BoF attendance, card exchanges |
| **Seeker** | Solve | Pursues specific information, puzzles, vendor Q&A |

Classes are a starting point, not a constraint. Attendees can customize further.

### Ghost Memory

Each ghost has an assigned **memory module** that governs how it stores, retrieves, and prioritizes what it has learned. Memory is not a world mechanic — it is an agent-layer concern, and different implementations are explicitly supported.

A memory module might be as simple as a key-value store of facts tagged by source and time, or as sophisticated as a vector store with semantic retrieval, a knowledge graph, or a continual learning system that updates representations over time. What a ghost remembers, how it recalls information under pressure, and how it handles conflicting or redundant inputs are all properties of its memory module — not of the world.

**Vendors are invited to contribute memory modules.** A vendor specializing in retrieval, observability, or knowledge representation can provide a module that ghosts can be configured to use — turning memory itself into a live differentiator that attendees can evaluate in a running system. This is not a sponsorship slot. It is a technical contribution with a working demo embedded in the game.

### Autonomy and Human-in-the-Loop

Each ghost has a **check-in setting** on a five-point scale:

| Level | Label | Behavior |
|---|---|---|
| 1 | Let it run | Only surfaces goal-level conflicts; full autonomy |
| 2 | Check in sometimes | High-value forks only; short wait, then continues |
| 3 | Keep me posted | Meaningful decision points; moderate wait |
| 4 | Ask me often | Most forks; waits longer for input |
| 5 | I'm driving | Every step; manual mode |

Checkpoints are **briefings, not permission gates**. Each one reports progress toward the current goal, proposes a next action, and offers a short list of alternatives. If the attendee doesn't respond before the timeout, the ghost continues on its default path.

One rule is invariant regardless of setting: **irreversible actions always checkpoint**, with a shorter wait time than the level default.

The check-in level is also context-sensitive. When an attendee is inactive, the ghost drops to level 1 automatically.

### Goals and Plans

Ghosts operate against **goals**, not scripts. A goal generates a plan — a sequence of subgoals — which the ghost executes autonomously. Checkpoints are generated by the plan when forks arise that are worth surfacing. Goals have states: active, completed, abandoned, blocked.

The goal stack is inspectable at any time. Power users (Seekers, Scholars) will live in this view.

### Identity and Social Layer

When two ghosts are on neighboring tiles, they can exchange **ghost cards** — the digital equivalent of a badge sticker or colored lanyard. A card carries whatever the attendee chose to share: a one-liner about their work, what they're looking for, relevant URLs, and interest tags.

Interest tags (e.g., "building with LLMs", "hiring", "looking for co-founder", "I have a problem with X") are broadcast passively by ghosts. Connectors and Seekers can filter movement toward matching signals.

A card exchange is a first-class game event — it creates a persistent connection between two ghosts that enables information sharing across distance for the rest of the conference.

Ghosts can **friend or distrust** other ghosts, affecting future interactions and information sharing.

### BoF Zones

At scheduled times (lunch, coffee breaks), **BoF tiles** activate. Ghosts with matching interest tags are nudged toward them. Attendees whose ghost ends up at a BoF receive a notification: *"Your ghost is at a BoF on agent orchestration — 6 connected ghosts are there. Want to join them in the real world?"*

This is the loop that makes the digital twin genuinely useful: the ghost discovers something the IRL attendee might want to act on physically.

---

## Vendor and Sponsor Integration

Vendors are first-class citizens. Each vendor has a **booth area** — a set of tiles in the Moscone floor plan — and can deploy:

- **NPC agents** confined to (or near) their booth, capable of answering questions, pitching products, and interacting with passing ghosts
- **Information kiosks** — static, time-based, or spatially triggered content: URLs, product info, hints, skills, demos
- **Quests and puzzles** — tasks ghosts can pick up and complete for rewards (raffle entries, collectible badges, leaderboard points)
- **Memory modules** — vendor-contributed agent memory implementations that attendees can assign to their ghost

Vendors are free to provide whatever content they choose. The platform provides the surface; vendors provide the experience.

**Cross-vendor quest chains** are a particularly powerful mechanic: a puzzle requiring clues from multiple booths, rewarding a joint prize. These create organic vendor cooperation and drive floor traffic naturally.

---

## Sessions and Speaker Agents

For every scheduled session, a **speaker agent** is deployed to the corresponding room tile. The speaker agent:

- Relays content from the IRL talk via slide ingestion, abstract, or live feed integration
- Can play "PowerPoint karaoke" — imagining the talk from title, abstract, and slides when live content isn't available
- Is only audible to ghosts present in the room tile

Session attendance is a tracked ghost stat. Scholars optimize for it. The speaker agent is also a source of information that ghosts carry with them after leaving — creating an information diffusion dynamic shaped by each ghost's memory module.

---

## Game Mechanics and Competitions

The Matrix supports several emergent and structured game modes:

- **Leaderboards** — per-class metrics: steps taken, sessions attended, cards exchanged, quests completed, puzzles solved
- **Information diffusion** — facts spread ghost-to-ghost through proximity; a ghost's memory module determines what it retains and can share
- **Prisoner's dilemma dynamics** — cooperation and competition over scarce resources (raffle entries, quest rewards, restricted tiles)
- **Zebra puzzles** — logic puzzles whose clues are distributed across tiles, booths, or session content; solvable only by exploration or collaboration
- **Question-answering competitions** — ghosts (and their humans) compete to answer questions correctly, drawing on accumulated session knowledge
- **Location-based challenges** — puzzles that require a ghost to be in a specific place at a specific time

---

## Notifications

Notifications are delivered in-game as **checkpoint briefings**, associated with an active goal. Each briefing includes:

- Current goal and progress
- Reason for surfacing (schedule conflict, interesting fork, nearby BoF, quest opportunity)
- Proposed next action
- A short array of alternatives
- An expiry time and default behavior if unanswered

Push notification delivery (web push, mobile) is a natural extension requiring minimal additional infrastructure.

---

## Technical Foundation

The initial stack is:

- **Intermedium** (`clients/intermedium/`) — the primary conference attendee interface. A React + deck.gl web client that renders the ghost world as H3 hex geometry across a 7-stop camera model (Global → Regional → Neighborhood → Plan → Room → Situational → Personal). The Personal stop uses React Three Fiber for a non-geospatial ghost presence view. Attendees read and send messages to their paired ghost here.
- **Phaser debugger** (`clients/debugger/`) — 2D hex-tile developer tool for verifying game mechanics; not the attendee interface.
- **Colyseus** — authoritative multiplayer server; handles real-time state sync, room management, and targeted notification delivery
- **Neo4j** — world graph: tiles, connectivity, ghost positions, goal state, social graph, quest progress; hex-tile proximity and pathfinding are natural graph traversals

Agent reasoning — from rule-based to LLM-driven — is designed as a cleanly separated layer above the game engine, so implementations can vary without touching the core world model. Ghost memory is similarly modular: the interface is defined by the platform, the implementation is open to contribution.

---

## Contribution Areas

The Matrix is designed as a cross-organization collaboration. Every vendor, sponsor, and speaker at AIEWF is invited to participate in building it. Below are the natural contribution surfaces.

**Infrastructure**
Server deployment, Colyseus cluster management, database hosting, CDN, and reliability engineering for a live event environment.

**Game Mechanics**
Tile system design, movement rules, quest engine, leaderboard logic, BoF activation, and the social graph mechanics (friending, distrust, card exchange).

**World Modeling**
Accurate hex-tile modeling of Moscone West — floors, rooms, booths, transitions. Ideally done in collaboration with AIEWF organizers and venue data.

**Frontend / Mobile**
Phaser **debugger** (`clients/debugger/`), **intermedium** human spectator client (`clients/intermedium/` — full-bleed H3 world, **overlay** UI, goals/memories copy per RFC-0008), ghost management UI, goal stack inspector, checkpoint briefing interface, ghost card design, and mobile-responsive layout. A spectator/ambient view of the world for hallway screens and livestreams.

**Agent Architecture**
The ghost reasoning layer: goal decomposition, plan generation, checkpoint triggering logic, and the significance-scoring system that determines when to surface a decision point. Clean abstractions that support multiple agent implementations.

**Ghost Memory**
Design and implementation of the memory module interface and reference implementations. Vendor-contributed modules are explicitly welcome — this is a live evaluation environment for memory systems.

**LLM Integration**
Speaker agent content generation, vendor NPC dialogue, ghost natural language goal-setting, and Seeker-class reasoning. Prompt design, model selection, latency management, and cost optimization for a live event context.

**APIs and Keys**
Conference schedule ingestion, slide/abstract processing, vendor content APIs, authentication, and attendee identity linking.

**Eval**
Question-answering competition infrastructure, ghost knowledge benchmarking, session coverage scoring, and puzzle answer validation. The Matrix is a live multi-agent eval environment; this layer is as much a research surface as a game feature.

**Production Scaling**
Load testing, concurrency modeling for peak conference periods, graceful degradation, and operational runbooks for a live event that cannot go down.

---

## Who Might Contribute What

The following maps AIEWF 2026 sponsors and session tracks to contribution areas. It is not a commitment on anyone's behalf — it is an invitation to a conversation.

**Microsoft** *(Presenting Sponsor)* — Azure infrastructure for hosting; models for ghost reasoning and speaker agents; potential integration with developer tooling for the coding agent vertical.

**AWS** *(Platinum)* — Production cloud infrastructure, scaling, and reliability; Bedrock for LLM integration; potential contribution to ghost memory via search and retrieval services.

**Google DeepMind / Anthropic / OpenAI** *(Labs)* — Model providers for ghost reasoning, speaker agent generation, and NPC dialogue. Natural candidates for contributing distinct ghost reasoning strategies — making the Matrix a live, comparative environment for model capabilities.

**Neo4j** *(Platinum)* — The world graph, tile connectivity, ghost social graph, and pathfinding are native Neo4j territory. Natural home for the reference world model and a graph-native memory module.

**Arize** *(Platinum)* — Observability and tracing for agent behavior: logging ghost decisions, monitoring checkpoint events, tracking LLM calls across the agent layer. The Matrix generates rich agent telemetry; Arize's tooling fits naturally over it.

**Docker** *(Platinum)* — Containerization and sandboxing for vendor NPC agents and memory modules, mapping directly to the Sandboxes track themes.

**Together AI** *(Platinum)* — Fast inference for real-time ghost reasoning; a strong fit for latency-sensitive agent decisions during peak conference hours.

**Browserbase** *(Platinum)* — Seeker-class ghosts that fetch live web content as part of information gathering — real research on behalf of attendees, running during the conference.

**Oracle** *(Platinum)* — Enterprise-scale data persistence and identity; potential contribution to the attendee authentication and badge-linking layer.

**Memory & Continual Learning track** — The most direct contributors to the ghost memory module interface. A talk on episodic memory or continual learning could ship a working memory module as its live demo.

**Evals & Observability track** — The question-answering competition and ghost knowledge benchmarking infrastructure. Speakers here are building exactly the tooling needed to measure ghost performance at scale.

**Graphs track** — GraphRAG, knowledge graphs, and GNNs all have a home in the ghost memory layer or world model. Contributions here could demonstrate graph-native retrieval in a running system with real users.

**Claws / Personal Agents track** — The ghost *is* a personal agent operating on behalf of an IRL human. Speakers in this track are building exactly what ghosts need to be. This is the most direct alignment in the entire conference program.

**Search & Retrieval track** — RAG and deep research implementations are natural fits for Scholar-class ghost memory. A ghost that synthesizes session content across the conference is a working demo of what this track discusses.

**Sandboxes track** — Safe execution environments for vendor-contributed NPC agents and memory modules; vendors need to run code without threatening shared world state.

**Security track** — Trust and movement constraints in the tile system, ghost identity verification, and the distrust mechanic all have security dimensions worth getting right from the start.

**Voice track** — Ghost interaction via voice; a natural mobile UX for giving a ghost a goal without typing, especially useful on the conference floor.

**Coding Agents / Vertical tracks** — The Matrix itself is a project that could be partially built by coding agents, with the process documented and demonstrated at the conference — a meta-contribution.

---

## Local development and debugging

Contributors can drive the ghost MCP surface directly without writing a house harness:

- **`ghost-cli`** (`@aie-matrix/ghost-cli`, under `ghosts/ghost-cli/`) — one-shot subcommands (`whoami`, `whereami`, `look`, `exits`, `go`) for scripts and CI, and an interactive Ink REPL when invoked with no subcommand in a TTY. See `ghosts/README.md` and `specs/004-ghost-cli/quickstart.md`. From the repo root, `pnpm run ghost:cli` is a shortcut to the package entry point; `pnpm run ghost:register` provisions credentials on first use.

---

## Open Questions for Collaborators

- What does the memory module interface look like? What must every implementation provide, and what is left to the implementation?
- What does vendor NPC behavior look like at the limit — can agents roam, recruit, or offer dynamic quests?
- What is the right mobile UX for async ghost management during a live session?
- How does the speaker agent handle live talks vs. pre-submitted slides vs. abstract-only sessions?
- What privacy and consent model governs ghost card exchange and identity sharing?
- Can the platform generalize beyond AIEWF to other events?

---

## Status

This document is the conceptual foundation. A separate **Project Plan** will detail architectural designs, component breakdown, and phased delivery milestones.

The goal for AIEWF 2026 (June 29 – July 2, Moscone West, San Francisco) is a working system — not a prototype. Ghosts should move, sessions should have agents, vendors should have booths, and attendees should be able to adopt and manage a ghost from their phone on the conference floor.

Everything is connected.

---

*Inspired by conversations at AI Engineer Europe. Built for AI Engineer World's Fair 2026, San Francisco.*
