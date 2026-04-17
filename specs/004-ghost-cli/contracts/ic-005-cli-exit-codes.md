# IC-005: CLI Exit Code Contract

**Feature**: `004-ghost-cli`
**Consumer**: Shell scripts, CI pipelines, contributors calling `ghost-cli` one-shot commands

---

## Purpose

Defines the exit code contract for `ghost-cli` one-shot mode. Downstream shell scripts and CI checks may rely on these codes to distinguish failure categories without parsing stderr.

---

## Exit codes

| Code | Category | Conditions |
|------|----------|------------|
| `0` | Success | Tool call completed; result printed to stdout |
| `1` | Configuration failure | Missing `GHOST_TOKEN`, missing `WORLD_API_URL`, malformed URL (missing `/mcp` suffix) |
| `2` | Infrastructure failure | Server not running (`ECONNREFUSED`), hostname unresolvable (`ENOTFOUND`), MCP endpoint 404 |
| `3` | Authentication failure | Token rejected (401 from world-api), ghost not found (404 ghost evicted) |

---

## Guarantees

- Exit code is always one of `{0, 1, 2, 3}` for conditions covered by the pre-flight diagnostic layer.
- Unhandled defects (programming errors) may exit with Node.js default (1 or uncaught exception code).
- In interactive mode, exit code is always `0` on graceful shutdown (`exit`, `quit`, Ctrl-C).
- `--debug` does not alter exit codes; it only adds verbose output on stderr.
- `--json` does not alter exit codes; it only changes stdout format.

---

## Stderr / stdout split

| Stream | Content |
|--------|---------|
| stdout | Tool result (prose or JSON); empty on failure |
| stderr | Diagnostic messages, remediation instructions, `--debug` raw payloads |

Scripts that pipe `ghost-cli` output MUST only read stdout. Diagnostic messages on stderr MUST NOT be machine-parseable; their format may change between releases.

---

## Example shell usage

```bash
# Check if ghost is reachable; fail CI if not
ghost-cli whoami > /dev/null
case $? in
  0) echo "Ghost is online" ;;
  1) echo "Configuration error — check GHOST_TOKEN and WORLD_API_URL" ;;
  2) echo "Server not running — start with pnpm run poc:server" ;;
  3) echo "Authentication failure — re-adopt with pnpm run poc:ghost" ;;
esac
```

---

## Related

- [IC-004](./ic-004-ghost-client-service.md) — GhostClientError variants that map to exit codes
- [data-model.md](../data-model.md) — `PreFlightError` taxonomy
