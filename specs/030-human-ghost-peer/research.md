# Research: Human Participation as Ghost Peer

## Decision 1: JWT role claim placement

**Decision**: Add `role?: string` to `GhostClaims` in `server/world-api/src/jwt.ts`, and populate `auth.extra.role` from it in `auth-context.ts`.

**Rationale**: The spawn-grant code in `mcp-server.ts:2255` already reads `authExtra?.role` with a fallback to `"attendee"`. The infrastructure is ready — the JWT claim is simply missing. Adding it to `GhostClaims` closes the loop with zero structural change to the spawn-grant path.

**Alternatives considered**: Fetching role from the agent catalog via `agentId` (the original intent per the in-code comment). Rejected for this feature because humans have no catalog entry; the JWT claim is both simpler and more correct for the human case.

---

## Decision 2: ConversationService proximity exemption

**Decision**: Add `callerRole?: string` as a parameter to `ConversationService.say()`. The `sayEffect()` in `mcp-server.ts` extracts role from the JWT and passes it. The `say()` implementation skips the position check when `callerRole === "human"` and `to` is specified.

**Rationale**: `ConversationService.say()` receives only `(ghostId, content, to?, displayName?, intent?)` — no auth context. Rather than threading `AuthInfo` through to the conversation layer (a large coupling change), a narrow `callerRole` string parameter preserves the service's existing interface shape while giving the proximity guard exactly the information it needs.

**Alternatives considered**:
- Passing full `AuthInfo` to `ConversationService` — rejected; over-couples auth to conversation logic.
- Looking up role from a registry inside `say()` — rejected; requires a new dependency on world-api's auth store from the conversation service.
- Checking for Colyseus position absence as a proxy for "human" — rejected; a ghost that temporarily loses its Colyseus slot would get the same exemption, creating a soundness bug.

---

## Decision 3: Broker identification in client

**Decision**: Add `ghostLabels: MapSchema<string>` to `WorldSpectatorState` in `server/colyseus/src/room-schema.ts`. The npc-agent populates labels from the character gram when a ghost joins. The client reads labels to badge broker ghosts.

**Rationale**: No existing Colyseus field carries character class or role information. Rather than a separate HTTP call to identify brokers, broadcasting labels in the room state keeps the pattern consistent with how `ghostModes` and `ghostLastActions` already work — as reactive Colyseus state, not pull-based queries.

**Alternatives considered**:
- A new `GET /npcs?role=broker` endpoint — rejected; adds a bespoke HTTP endpoint for a domain query (constitution V violation).
- Reusing `ghostLastActions` to encode role — rejected; that field is already semantically owned by action logging.
- Client-side agent card fetch per ghost — rejected; too slow and chattier than room state.

---

## Decision 4: Guest token endpoint placement and shape

**Decision**: `POST /auth/guest` on `server/world-api`. Accepts `{ ghostId: string, displayName?: string }`, returns `{ token: string }`. Issues a JWT with `{ sub: ghostId, ghostId, role: "human" }` and 8h TTL (matching existing ghost TTL). No registration, no catalog side-effects.

**Rationale**: world-api already owns JWT issuance and the MCP endpoint. Placing the guest route here avoids cross-service dependencies. The endpoint is exempt from the MCP/A2A-first rule (constitution V) because it is identity infrastructure, not a domain operation.

**Alternatives considered**: Placing it on agent-host — rejected; agent-host manages ghost registration and humans don't register. Separate auth service — rejected; premature, one endpoint does not justify a service.

---

## Decision 5: Contract discovery for human client

**Decision**: Client calls `eval_contract_list` MCP tool (no state filter) using the human's JWT. The tool already returns contracts where the caller is a party (client, contractor, or evaluator). Human contractors see their open/submitted contracts in the response.

**Rationale**: The MCP tool already scopes results to the caller. No new endpoint or mechanism is needed. The client polls this tool on load and after any `say()` that contains "accept", to detect newly opened contracts quickly.

**Alternatives considered**: WebSocket push for contract events — deferred; the leaderboard already uses polling and the fair is time-bounded, so 5s polling is sufficient.
