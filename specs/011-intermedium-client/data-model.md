# Data Model: Intermedium — Human Spectator Client

**Feature**: 011-intermedium-client  
**Date**: 2026-04-26

All types are TypeScript interfaces local to `clients/intermedium/src/types/`. Where the field is an H3 index, the value is a res-15 H3 cell string (e.g., `"8f2830828052d25"`).

---

## ViewState

Top-level navigation state maintained by `useViewState`. Drives all layout decisions and data subscriptions.

```typescript
type Scale = 'map' | 'area' | 'neighbor' | 'partner' | 'ghost';

interface ViewState {
  scale: Scale;
  // null at 'map' scale; region identifier at 'area'; ghostId at 'neighbor'/'partner'/'ghost'
  focus: string | null;
}
```

**Transitions**:
- `map` → `area`: double-click a tile or cluster; sets `focus` to the clicked H3 index
- `area` → `neighbor`: double-click a ghost; sets `focus` to the ghost ID
- `neighbor` → `partner`: explicit navigate-deeper action; `focus` stays as ghost ID
- `partner` → `ghost`: explicit navigate-deeper action; `focus` stays as ghost ID
- Any → parent: back-control or keyboard shortcut; `focus` regresses to parent-appropriate value (null at map, region at area)

**Scale:Panel ratios**:

| Scale | Scene | Panel |
|-------|-------|-------|
| map | 100% | 0% |
| area | 80% | 20% |
| neighbor | 50% | 50% |
| partner | 20% | 80% |
| ghost | 0% | 100% |

---

## GhostPosition

Live ghost locations from the Colyseus `ghostTiles` broadcast.

```typescript
interface GhostPosition {
  ghostId: string;           // UUID
  h3Index: string;           // H3 res-15 cell index
  previousH3Index?: string;  // previous cell; absent on first broadcast; used to derive movement direction
}
```

**Source**: Colyseus `WorldSpectatorState.ghostTiles` map schema (key = ghostId, value = H3 index string). Per IC-008 (spec-005) and IC-001 (this feature).

**Movement direction**: Computed in `GhostStatusWidget` by comparing `h3Index` and `previousH3Index` using `h3.areNeighborCells()` and the bearing between cell centroids. Falls back to "stationary" when `previousH3Index` is absent.

---

## GhostIdentity

Public metadata about a ghost, displayed at Area and Neighbor scale.

```typescript
interface GhostIdentity {
  ghostId: string;
  name: string;
  ghostClass: string;   // e.g., "wanderer", "listener", "social"
}
```

**Source**: `GET /catalog` on the ghost house server (spec-009 IC-005). The intermedium fetches the catalog once at startup and refreshes on demand. Implemented via `useGhostIdentity` hook in `clients/intermedium/src/hooks/useGhostIdentity.ts`.

---

## WorldTile

A single H3 cell in the world map, parsed from the `.map.gram` payload at startup.

```typescript
type TileType = 'open' | 'vendor' | 'session' | 'lounge' | 'corridor' | string;

interface WorldTile {
  h3Index: string;
  tileType: TileType;
  items: string[];        // item type identifiers placed on this tile
  neighbors: string[];    // adjacent H3 cell indices (from gram topology)
}
```

**Source**: `GET /maps/:mapId?format=gram` → parsed by `gramParser.ts` using `@relateby/pattern`.

---

## ConversationMessage

A single message in the paired-ghost conversation thread.

```typescript
type MessageSender = 'human' | 'ghost';

interface ConversationMessage {
  messageId: string;           // ULID
  sender: MessageSender;
  content: string;
  timestamp: string;           // ISO 8601
}
```

**Source**: A2A conversation stream (stubbed in MVP per R-004). Sent messages are optimistically appended before server confirmation.

---

## ConversationThread

The full conversation history between the attendee and their paired ghost.

```typescript
interface ConversationThread {
  ghostId: string;
  messages: ConversationMessage[];
  isLoading: boolean;
  isAvailable: boolean;   // false when A2A conversation endpoint is not reachable (MVP stub)
}
```

---

## GhostInteriority

The inner state of a ghost, shown at Ghost scale. Stubbed in MVP.

```typescript
interface InventoryItem {
  itemId: string;
  name: string;
  quantity: number;
}

interface Quest {
  questId: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'failed';
}

interface MemoryEntry {
  entryId: string;
  content: string;
  timestamp: string;   // ISO 8601
}

interface GhostInteriority {
  ghostId: string;
  inventory: InventoryItem[];
  activeQuest: Quest | null;
  memoryLog: MemoryEntry[];
  isAvailable: boolean;   // false until ghost house read API is defined (IC-003)
}
```

---

## ProximityCluster

The set of ghosts within the 7-hex ring of H3 neighbors around the focused ghost at Neighbor scale.

```typescript
interface ProximityCluster {
  focusGhostId: string;
  neighbors: string[];           // H3 indices of the 7-cell ring (h3.gridDisk(focusH3Index, 1))
  ghostsInCluster: GhostIdentity[];  // ghosts whose h3Index is in `neighbors`
}
```

**Computed**: Derived client-side from `ghosts` (Colyseus positions) and `identities` (catalog) on each `viewState` change to Neighbor scale. No backend endpoint required.

---

## HumanPairing

The association between the current human attendee and their ghost. Read-only; pairing lifecycle is managed externally.

```typescript
interface HumanPairing {
  ghostId: string;        // the attendee's paired ghost ID
  // MVP: read from ?ghost=<ghostId> URL parameter
}
```

**Null state**: If no pairing token is present, `HumanPairing` is `null`. Partner and Ghost scales are unavailable.

---

## ClientState (composed)

Top-level React context value assembling all data sources.

```typescript
interface ClientState {
  viewState: ViewState;
  ghosts: Map<string, GhostPosition>;    // ghostId → position
  identities: Map<string, GhostIdentity>;
  tiles: Map<string, WorldTile>;          // h3Index → tile
  thread: ConversationThread | null;      // null when no pairing
  interiority: GhostInteriority | null;  // null when not at ghost scale
  pairing: HumanPairing | null;
}
```
