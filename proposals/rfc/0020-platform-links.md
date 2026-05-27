# RFC-0020: Platform Links — Pocket World Navigation Protocol

**Status:** draft
**Date:** 2026-05-27
**Authors:** @akollegger
**Related:** [RFC-0006](0006-world-objects.md) (world items — Platform is an item kind), [RFC-0019](0019-barnacle-protocol.md) (earlier approach to mini-game handoff — this RFC proposes an alternative)

## Summary

Simplify mini-game and external-context handoff by treating Platform tiles as **links**. A ghost that steps onto a Platform tile enters a world-managed idle state, suppressing A2A broadcasts without any ghost-side cooperation. The ghost agent may then optionally follow the Platform's advertised URL — connecting directly to an external server as itself, presenting its identity token. The matrix world always maintains a ghost's last known state, so a ghost can leave, spend time in a pocket world, and ask "whereami?" on return. This follows HTTP link-following precedent closely, with one key inversion: unlike HTTP where the client tracks history and the server is stateless, the matrix world is always stateful about its ghosts.

## Motivation

RFC-0019 (Barnacle Protocol) solves the right problem — isolating mini-game failures from the world, enabling polyglot contributions, defining a clear contract for external game contexts — but pays too high a coordination cost:

- Requires an explicit `pause.v1` / `resume.v1` A2A protocol that every ghost implementation must correctly support.
- The supervisor (ghost-house) must actively orchestrate a three-party handoff: remove ghost from world, pause peppers, hand off to mini-game.
- "Two processes, one identity" is a valid architecture for the peppers/RDC split specifically but is not a generalizable primitive.
- A crash in the ghost agent mid-handoff leaves the world in an inconsistent state that requires supervisor intervention to recover.

The link model replaces all of this with two simpler, independently testable mechanisms:

1. **World-managed idle state** — tile occupancy determines whether a ghost receives A2A broadcasts. No ghost cooperation required.
2. **Direct link following** — the ghost agent connects to the external server itself, carrying its identity token. No proxy, no supervisor handoff.

This also generalizes beyond mini-games. Any external server that speaks the ghost credential protocol can be a Platform link destination — vendor booths with richer interaction models, speaker Q&A services, external puzzle engines, anything. The world doesn't need to know what's on the other end of a link.

The HTTP analogy is deliberately close: a Platform tile is an `<a href>`. Stepping onto it is hovering. Following it is clicking. The ghost's identity token is the cookie. The world's persistent ghost state is what HTTP servers don't have by default but the matrix world always provides.

## Design

### Platform Tile as Link

A Platform tile (RFC-0006 `Platform:*` item) gains one new field:

```ts
interface PlatformItem {
  readonly kind: "Platform";
  readonly subclass: string;          // e.g. "PokerTable", "VendorBooth"
  readonly href?: string;             // URL of the pocket world server (optional)
  readonly displayName?: string;
}
```

`href` is optional — a Platform tile without one is a spatial landmark only (can still trigger idle state). A Platform tile with one advertises a linkable destination.

### World-Managed Idle State

When a ghost **steps onto** a Platform tile, the world:
- Marks the ghost `idle` in its internal state (no new schema needed — a flag on the ghost's world record)
- Suppresses A2A broadcast delivery to that ghost

When a ghost **steps off** a Platform tile (via any MCP `go` command to an adjacent non-Platform tile), the world:
- Clears the `idle` flag
- Resumes A2A broadcast delivery

No `pause.v1` / `resume.v1` protocol. No ghost-side state machine. Idle is inferred entirely from tile occupancy on the world server side. Concretely: world-api owns the idle flag (set and cleared on `go` transitions); agent-host reads it to suppress A2A broadcast delivery to idle ghosts.

The MCP endpoint remains open throughout. A ghost on a Platform tile can still call `whereami`, `look`, `exits`, and `go`. This means the ghost agent retains full agency — it can decide to leave without any signal from the pocket world.

### Link Following

Following a Platform link is entirely optional and entirely the ghost agent's decision:

```
ghost steps onto Platform tile
  → world marks ghost idle (A2A suppressed)
  → ghost calls MCP look / exits — sees Platform item with href
  → ghost decides to follow (or not — may just stand there or walk away)

if follow:
  → ghost connects directly to href, presents identity token
  → external server runs its session
  → ghost decides to leave, calls MCP `go` to step off tile
  → world marks ghost active (A2A resumes)
```

The external server and the world server do not communicate with each other. There is no supervisor. The ghost is the only party that knows it visited both.

### Identity Token in Link Following

When the ghost agent follows a Platform link, it presents its world-issued identity token to the external server. This is the same token it uses for MCP calls — it is the ghost's credential, scoped to its `ghostId`.

What operations that token permits — at the destination and back at the world — is deferred to the auth RFC. v1 passes the token as-is; contributors building pocket worlds should assume the permission surface will be tightened.

### World-Stateful Ghost ("whereami")

The matrix world always maintains a ghost's last known state: tile, idle flag, inventory, session record. This is a first-class design invariant, not a convenience feature.

A ghost agent that:
- Crashes mid-session in a pocket world
- Loses its connection to the world server
- Is away for an arbitrary duration

...can reconnect to the world MCP endpoint and call `whereami` to recover full context. The world answers without requiring the ghost to have stored anything locally.

This inverts HTTP's statelessness convention:

| | HTTP | Matrix |
|--|------|--------|
| Client remembers where it was | History / bookmarks | Not required |
| Server remembers the client | Optional (cookies, sessions) | Always |
| Return from external context | Back button (client-side) | `whereami` (server-side) |

This statefulness is what makes the link model safe to use without a supervisor: if the ghost crashes in a pocket world, it simply comes back and finds itself still on the Platform tile, idle. It can step off and resume as normal.

### Worked Example: Ghost Plays Poker

```
ghost wanders → steps onto PokerTable tile
  → world marks ghost idle
  → A2A broadcasts suppressed

ghost calls MCP look
  → sees PokerTable Platform item with href: "https://rdc-poker.internal/a2a"

ghost decides to follow
  → ghost agent connects to rdc-poker server, presents identity token
  → rdc-poker runs the session (hands, turns, outcomes)
  → session ends

rdc-poker instructs ghost to step off (or ghost decides independently)
  → ghost calls MCP `go` to adjacent tile
  → world marks ghost active
  → A2A broadcasts resume

ghost calls MCP whereami
  → recovers current tile, state — continues wandering
```

Crash path: ghost agent crashes mid-hand. On restart, ghost calls `whereami` → still on PokerTable tile, idle. Ghost calls `go` to step off → active. No supervisor intervention.

### Acceptance Criteria

- A ghost that steps onto a Platform tile stops receiving A2A broadcasts without any explicit pause call.
- A ghost that steps off a Platform tile resumes receiving A2A broadcasts.
- A ghost can call `look` on a Platform tile and read its `href` field.
- A ghost that crashes while idle on a Platform tile can call `whereami` on reconnect and find itself still on that tile, idle.
- A Platform tile without an `href` still triggers idle state.

### What Changes Relative to RFC-0019

| RFC-0019 (Barnacle) | RFC-0020 (Platform Links) |
|---|---|
| Supervisor (ghost-house) orchestrates handoff | No supervisor involvement |
| Explicit `pause.v1` / `resume.v1` A2A | World-managed idle from tile occupancy |
| Mini-game receives handoff bundle, acts as ghost | Ghost agent connects directly to external server |
| Two processes share one identity | One process, one identity, two servers |
| Crash recovery requires supervisor | Ghost reconnects and asks `whereami` |
| Ghost-house catalog maps platform classes to mini-games | Platform tile carries its own `href` |

`removeGhostCell` from RFC-0019 is not needed — the ghost remains on the tile (visible as idle rather than absent).

## Open Questions

1. **Pocket world attachment (deferred to auth RFC).** Before a pocket world can receive ghosts with live identity tokens, it needs to prove to the matrix world that it is a legitimate destination. This is an authentication concern analogous to OAuth client registration — the pocket world authenticates to the world once, establishing trust, before individual ghosts authenticate to it. What individual tokens permit is a separate scoping question inside the same auth RFC. Both are out of scope here; v1 operates without attachment verification.

## Alternatives

**1. RFC-0019 Barnacle Protocol.** Richer supervision model, explicit session lifecycle, cleaner crash recovery story for the supervisor. The cost is coordination complexity and a ghost architecture constrained to the peppers two-process model. Barnacle is the right answer if we want the world to have authoritative session knowledge; platform links are the right answer if we want the ghost to be the session authority.

**2. World-as-proxy.** The world server forwards interactions to the external server on the ghost's behalf. Maintains a single connection point for the ghost agent. Rejected: the world becomes tightly coupled to every pocket world's protocol, and a slow external server blocks the ghost's world connection.

**3. World-managed redirect.** Ghost-house or the world server issues an A2A redirect instruction telling the ghost which URL to connect to, rather than the Platform tile advertising its `href` directly. Slightly more control (the world can swap destinations dynamically), but adds a round-trip and re-introduces ghost-house as a required participant. The tile-as-link model is simpler and the destination can still be updated by editing the tile's item definition.
