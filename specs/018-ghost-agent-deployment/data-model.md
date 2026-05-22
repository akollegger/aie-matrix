# Data Model: Ghost Agent Deployment (018)

No new persistent data models are introduced. This feature adds deployment packaging around existing data flows.

## Env Var Contract (ghost package)

Every first-party ghost package reads these variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `AGENT_HOST_URL` | yes | — | Base URL of the agent-host (`http://agent-host:4000` in compose, ClusterIP in K8s) |
| `AGENT_HOST_TOKEN` | yes | — | Shared bearer token — must match agent-host's `GHOST_HOUSE_DEV_TOKEN` until rename lands |
| `AGENT_PORT` | no | `4001` | Port this ghost listens on |
| `<NAME>_PUBLIC_BASE_URL` | yes | `http://127.0.0.1:${AGENT_PORT}` | Externally reachable base URL used in agent card `url` field and catalog registration |
| `AGENT_REGISTER_TIMEOUT` | no | `120000` (ms) | Max time to wait for successful registration before exiting |

For `random-agent` specifically: `RANDOM_AGENT_PUBLIC_BASE_URL`.

## Registration Payload (IC-001)

Sent by ghost to `POST /v1/catalog/register`:

```json
{ "agentId": "random-agent-${HOSTNAME}", "baseUrl": "<NAME>_PUBLIC_BASE_URL" }
```

Agent-host fetches `${baseUrl}/.well-known/agent-card.json` to populate the catalog entry. The agent card must be valid per IC-001 schema (`matrix` extension object required).

## Agent ID Derivation

```
agentId = "<ghost-name>-" + (HOSTNAME env var ?? "local")
```

In K8s, `HOSTNAME` is the pod name (set by the runtime). In compose, it is the container hostname (defaults to container ID prefix). In local dev, it is the machine hostname.

## Catalog Entry (read, owned by agent-host)

```json
{
  "agentId": "random-agent-<hostname>",
  "baseUrl": "http://<pod-ip>:4001",
  "agentCard": { "name": "random-agent", "matrix": { "tier": "wanderer", ... } },
  "registeredAt": "2026-05-22T...",
  "builtIn": false
}
```

The ghost does not own or persist this entry — it is owned by `server/agent-host/catalog.json`. The ghost's only writes are `POST /register` and `DELETE /:agentId`.

## State Transitions

```
[starting]
    │ listen() callback fires
    ▼
[registering] — retry loop, 2s backoff, up to AGENT_REGISTER_TIMEOUT
    │ POST /v1/catalog/register → 201
    ▼
[registered] — serving A2A requests, awaiting spawn
    │ SIGTERM received
    ▼
[deregistering]
    │ DELETE /v1/catalog/:agentId → 200 or 409 (log warning)
    ▼
[exited]
```

If registration times out, the process exits with code 1 and logs `{ kind: "random-agent.registration-timeout" }`.
