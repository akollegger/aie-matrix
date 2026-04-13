# ADR-0001: MCP as the Ghost Wire Protocol

**Status:** proposed  
**Date:** 2026-04-12  
**Authors:** @akollegger

## Context

Ghost agents are the primary consumers of `server/world-api/` — the service that exposes tile queries and movement commands. The choice of wire protocol for this interface has downstream consequences for every ghost implementation, every client SDK, and the Technology Compatibility Kit.

Two candidate protocols were on the table: REST (HTTP + JSON) and MCP (Model Context Protocol, Anthropic's open standard for connecting AI models to tools).

Ghost agents span a wide implementation range: rule-based walkers (the PoC), LLM-backed agents orchestrated by frameworks such as LangChain, LangGraph, AutoGen, or custom loops, and vendor-contributed NPC agents. The protocol must work for all of these without requiring custom glue code per framework.

The world-api interaction surface is small and well-scoped:

- Resolve session identity (`whoami`)
- Query current tile (`whereami`)
- Inspect relative to here (`look` with `here` / `around` / compass face only)
- List exits from here (`exits`, no args)
- Step one hex face (`go` with `toward` compass only — no arbitrary tile-id args)

This is precisely the shape that MCP tools are designed to expose.

## Decision

`server/world-api/` exposes an MCP server as its primary interface. Ghost agents interact with the world exclusively through MCP tool calls. The ghost client SDKs (`ghosts/ts-client/`, `ghosts/python-client/`) are MCP client wrappers, not HTTP client wrappers.

REST is not a primary ghost interface. It may remain as a secondary surface for operational tooling (health checks, admin queries), but ghost agents do not use it.

## Rationale

**LLM frameworks speak MCP natively.** The majority of ghost implementations will be built on agentic frameworks (LangChain, LangGraph, AutoGen, Claude tool use, etc.). These frameworks support MCP tool servers without custom integration. Pointing a framework at an MCP server gives it immediate access to short, adventure-flavored tools such as **`go`**, **`exits`**, **`look`**, **`whereami`**, and **`whoami`** (see RFC-0001 / IC-003) — no adapter code, no HTTP plumbing in the agent. With REST, every framework requires a custom wrapper.

**Tool discovery removes hardcoding.** MCP's `tools/list` returns machine-readable JSON Schema descriptions of available tools. An LLM agent can ask "what can I do here?" and get a complete, accurate answer. REST has no intrinsic equivalent; OpenAPI helps but is not consumed natively by LLM frameworks.

**The interaction surface is a natural fit.** Those tools are discrete, named, argument-bearing operations — the exact shape MCP tools are designed for. There is no streaming state, no resource subscription, no complex query language. The surface maps cleanly.

**Rule-based agents are not disadvantaged.** MCP client SDKs exist for TypeScript and Python. A rule-based random walker calling `go` / `exits` via an MCP client SDK is no more complex than calling a REST endpoint. The PoC is not harder; future LLM-backed ghosts are significantly easier.

**The protocol signals intent.** Adopting MCP communicates that ghosts are first-class AI agents, not REST API consumers. This shapes how contributors think about ghost architecture and lowers the barrier for contributors whose primary tooling is already MCP-aware.

## Alternatives Considered

**REST (HTTP + JSON)** — Simple, universal, well-understood. Any language with an HTTP library can consume it. The drawback for this project is that every LLM framework requires custom glue to call REST endpoints from within a tool-use loop. With three to four major frameworks likely represented across contributors, that glue would be written repeatedly and inconsistently. REST also has no intrinsic discovery mechanism, making it harder for new contributors to understand the ghost API surface without reading documentation.

**REST with a thin MCP adapter** — Expose REST as the canonical interface and wrap it in an MCP server that translates tool calls to HTTP requests. Keeps REST as the source of truth but maintains two surfaces to document, test, and keep in sync. The translation layer adds complexity without adding capability. Rejected in favor of MCP-first with REST as a secondary operational surface only.

**OpenAPI spec with auto-generated MCP** — Define the world API in OpenAPI and use emerging tooling to generate an MCP server from it. Attractive in principle; tooling is immature and introduces a build step dependency on tools with uncertain maintenance. Could be revisited once the OpenAPI-to-MCP generation ecosystem stabilizes.

**GraphQL** — Expressive query language with strong schema definition. Overkill for the small, fixed ghost interaction surface. No native LLM framework support. Not suitable.

## Consequences

**Easier:**
- LLM-backed ghost agents integrate with the world server without custom HTTP wrappers
- New agentic frameworks can be pointed at the MCP server and immediately discover the available tools
- The TCK is cleaner: compliance is defined as "successfully invoke these MCP tools and handle these responses"
- Ghost SDK authors in TypeScript and Python have mature MCP client libraries to build on
- The ghost interaction surface is self-documenting via `tools/list`

**Harder:**
- `server/world-api/` requires MCP server implementation rather than simple Express routes — meaningfully more involved, though MCP server SDKs for TypeScript and Python exist and are actively maintained
- Ghost implementations in languages without MCP client SDKs (Go, Rust, etc.) must implement the MCP JSON-RPC protocol directly or wait for SDK availability. REST would have been universally accessible.
- Contributors unfamiliar with MCP face a learning curve that REST would not impose
- MCP is a younger protocol than REST; its tooling and best practices are still evolving
