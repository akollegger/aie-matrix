# Contract: Technology Compatibility Kit (PoC minimal)

**IC-006** — Defines the **smallest** automated check that a live stack still exposes **registry adoption** and **MCP ghost read** for a freshly provisioned ghost. This is **not** a full GhostHouse certification, user-journey test, or multi-language matrix.

## PoC minimal subset (normative for Phase 6)

Run against a **already-running** combined server (e.g. `pnpm run demo` or `pnpm run poc:server`). The TCK performs **only**:

1. **Reachability** — `GET` `http://127.0.0.1:8787/spectator/room` (or configurable base) returns **200** with JSON including a room id (same URL quickstart uses as “server up”).
2. **Registry** — `POST /registry/caretakers`, `POST /registry/houses`, `POST /registry/adopt` using the same JSON shapes as `ghosts/random-house`; obtain `credential.worldApiBaseUrl` and `credential.token`.
3. **MCP** — Call **`whereami`** for that ghost and assert a structured **tile id** (or equivalent) is returned.

**Pass / fail**

- Process exits **0** only if all three steps succeed.
- On failure: **non-zero** exit; output includes a **short step label** (e.g. `[tck] adopt`, `[tck] whereami`) so logs are grep-friendly.

No requirement in PoC Phase 6 for: invalid `go`, `exits` enumeration, `tools/list`, shutdown hooks, second language client, or alternate GhostHouse CLIs.

## Explicitly deferred (document only; not Phase 6 gates)

- **Movement suite** — valid/invalid `go`, neighbor parity (use manual quickstart §1 and Playwright for regression until a later RFC).
- **GhostHouse catalog / user auth / spectator adoption** — product flows; TCK will not simulate them in PoC Phase 6.
- **`ghosts/python-client`** drift checks.
- **Parameterized** “point TCK at arbitrary house binary” — revisit when multiple houses exist and URLs are stable.

## Reference maturity (non-normative for PoC)

Future compatibility kits may extend toward: `exits` + valid/invalid `go`, clean shutdown, and second implementations. That expansion belongs in a follow-up RFC; this file intentionally stays small.
