# Vendored from pokerswarm-ai

The poker engine in `src/` is vendored from the [pokerswarm-ai](https://github.com/) project's `src/lib/poker/*` modules, with permission from the upstream author.

Modifications from the upstream:

- Removed `nanoid` dependency in favor of `crypto.randomUUID()` (Node 24+ built-in)
- Adjusted import paths to match this package's flat layout
- No behavioral changes — `vitest` test suite from upstream should continue to pass

If pokerswarm-ai adds an explicit license, this package should be re-evaluated for licensing alignment. Do not extract the engine from here for use in other projects without checking with the original author.
