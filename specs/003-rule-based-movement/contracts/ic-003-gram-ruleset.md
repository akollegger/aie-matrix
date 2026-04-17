# Contract IC-003-A: Gram ruleset authoring and loading

**Consumers**: `@aie-matrix/server-world-api` (loader + evaluator)  
**Authors**: World operators / contributors editing repository files  
**Normative references**: [RFC-0002](../../../proposals/rfc/0002-rule-based-movement.md), [@relateby/pattern](https://www.npmjs.com/package/@relateby/pattern) Gram API

## Purpose

Define how movement rules are **represented in source** and **loaded** so that:

- The same file can be reviewed in Git without running the server.
- Parse failures are detectable at startup.
- The permissive baseline remains selectable without Gram files.

## Artifact

- **Format**: UTF-8 text containing **Gram notation** accepted by `Gram.parse` from `@relateby/pattern`.
- **Naming**: Convention `*.rules.gram` (e.g. `sandbox.rules.gram`); multiple files MAY be composed by implementation if needed (concatenate before parse, or parse separately and merge pattern arrays).
- **Semantics**: Patterns MUST express **directed** relationships compatible with RFC-0002 (origin subject → relationship type → destination subject). **Canonical node syntax uses an identity with labels** (`(red:Red)`, `(from:Hallway:VIP)`) on first introduction; bare back-references (`(red)`) in subsequent rules resolve to the labels of the first labelled occurrence. Label-only syntax `(:Red)` — no identity — is **not** supported and will fail to match. Multi-label nodes use AND semantics: all listed labels must be present on the tile. Ghost constraints (`ghostClass`) and directional constraints (`toward`) belong as properties on the relationship subject, not on tile nodes. Exact property keys MUST be documented alongside the first implementation (stable catalog).

## Loading contract

1. **Configuration**: A single active rules source identifier (path or name) is resolved through existing server configuration conventions (environment / config object — exact key left to implementation; MUST be documented in `server/world-api` README when added).
2. **Parse**: Call `Gram.parse` (Effect). On `GramParseError`, the server MUST NOT silently enter authored mode; it MUST log diagnostics and exit startup **or** refuse to open rooms until fixed (implementation picks one; default **fail startup** for dev clarity).
3. **Permissive mode**: When selected, Gram files MAY be skipped; `rulesetAllowsMove` behavior is “always true” for class-pair checks (geometry still applies).

## Versioning

- Breaking changes to property keys or Gram shapes require a **bump** in documented rules version and updates to sample fixtures and TCK expectations.

## Verification

- At least one **fixture** `.gram` file in-repo that round-trips `Gram.parse` and encodes the asymmetric two-class demo from the spec.
