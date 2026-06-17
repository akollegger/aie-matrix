# Quickstart: Ghost Agent Autospawning

## Local verification

```bash
# 1. Start the full stack (includes npc-agent + random-agent)
pnpm run demo

# 2. In the map-editor admin panel: select a map and start a session
#    http://127.0.0.1:5182/

# 3. Confirm ghosts appear in Intermedium automatically
#    http://127.0.0.1:5180/

# 4. Verify the roster endpoint on random-agent
curl http://127.0.0.1:4001/v1/roster

# Expected: 10 wanderer entries
# [{"characterId":"wanderer-1","displayName":"Wanderer 1"}, ...]

# 5. Test configurable count
RANDOM_AGENT_COUNT=3 pnpm --filter @aie-matrix/random-agent dev
curl http://127.0.0.1:4001/v1/roster
# Expected: 3 entries
```

## Restart reconciliation test

```bash
# With an active session running in the demo stack:

# 1. Kill and restart agent-host
#    (or: pkill -f server-agent-host, then pnpm --filter @aie-matrix/server-agent-host dev)

# 2. Watch agent-host logs for:
#    {"kind":"agent-host.startup-reconciliation.found-session","sessionId":"..."}
#    {"kind":"agent-host.startup-reconciliation.roster-spawn-complete",...}

# 3. Confirm ghosts reappear in Intermedium within ~30s
```

## Run unit tests

```bash
pnpm --filter @aie-matrix/random-agent test
pnpm --filter @aie-matrix/server-agent-host test
```

## K8s env var

To set wanderer count in production, add to `deploy/k8s/ghosts/random-agent.yaml`:

```yaml
- name: RANDOM_AGENT_COUNT
  value: "10"
```
