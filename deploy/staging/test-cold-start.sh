#!/usr/bin/env bash
# test-cold-start.sh — verify ghost autospawn works after a full cold start.
#
# Simulates the GCP hard-stop scenario:
#   1. Bring up the full compose stack from scratch (catalog starts empty)
#   2. Activate a live session via the world API
#   3. Wait for agent-host reconciliation to spawn ghosts
#   4. Assert random-agent sessions are active
#   5. Tear down
#
# Usage:
#   cd deploy/staging
#   ADMIN_TOKEN=secret AGENT_HOST_TOKEN=secret ./test-cold-start.sh
#
# Optional env vars:
#   COMPOSE_FILE      — default: docker-compose.yml
#   WAIT_TIMEOUT      — seconds to wait for services/ghosts (default: 120)
#   GHOST_MIN_COUNT   — minimum random-agent sessions expected (default: 1)
#   KEEP_UP           — set to 1 to leave the stack running after the test

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-120}"
GHOST_MIN_COUNT="${GHOST_MIN_COUNT:-1}"
ADMIN_TOKEN="${ADMIN_TOKEN:?ADMIN_TOKEN is required}"
AGENT_HOST_TOKEN="${AGENT_HOST_TOKEN:?AGENT_HOST_TOKEN is required}"

SERVER_URL="http://127.0.0.1:8787"
AGENT_HOST_URL="http://127.0.0.1:4000"

CONTAINER_CMD="$(which podman 2>/dev/null || which docker 2>/dev/null || true)"
if [[ -z "$CONTAINER_CMD" ]]; then
  echo "[cold-start] ERROR: neither podman nor docker found in PATH" >&2
  exit 1
fi

COMPOSE_CMD="$CONTAINER_CMD compose"

log() { echo "[cold-start] $*"; }
fail() { echo "[cold-start] FAIL: $*" >&2; exit 1; }

# ── Cleanup on exit ──────────────────────────────────────────────────────────

teardown() {
  if [[ "${KEEP_UP:-0}" == "1" ]]; then
    log "KEEP_UP=1 — stack left running."
    return
  fi
  log "Tearing down compose stack…"
  $COMPOSE_CMD -f "$COMPOSE_FILE" down --volumes --remove-orphans 2>/dev/null || true
}
trap teardown EXIT

# ── Step 1: Bring up the stack ────────────────────────────────────────────────

log "Step 1/5: Building and starting compose stack (cold start, catalog empty)…"
$COMPOSE_CMD -f "$COMPOSE_FILE" down --volumes --remove-orphans 2>/dev/null || true
NEO4J_AUTH="neo4j/devpassword" \
NEO4J_PASSWORD="devpassword" \
ADMIN_TOKEN="$ADMIN_TOKEN" \
AGENT_HOST_TOKEN="$AGENT_HOST_TOKEN" \
  $COMPOSE_CMD -f "$COMPOSE_FILE" up --build --detach

# ── Step 2: Wait for world server ─────────────────────────────────────────────

log "Step 2/5: Waiting for world server at $SERVER_URL/health…"
deadline=$(( $(date +%s) + WAIT_TIMEOUT ))
while true; do
  status=$(node -e "
    fetch('$SERVER_URL/health')
      .then(r => r.json())
      .then(d => process.stdout.write(d.status === 'ok' ? 'ok' : 'not-ok'))
      .catch(() => process.stdout.write('error'))
  " 2>/dev/null || echo "error")
  if [[ "$status" == "ok" ]]; then
    log "  server healthy."
    break
  fi
  if (( $(date +%s) > deadline )); then
    fail "Timed out waiting for world server."
  fi
  sleep 3
done

# Wait for agent-host too
log "  Waiting for agent-host at $AGENT_HOST_URL/health…"
while true; do
  status=$(node -e "
    fetch('$AGENT_HOST_URL/health')
      .then(r => r.json())
      .then(d => process.stdout.write(d.status === 'ok' ? 'ok' : 'not-ok'))
      .catch(() => process.stdout.write('error'))
  " 2>/dev/null || echo "error")
  if [[ "$status" == "ok" ]]; then
    log "  agent-host healthy."
    break
  fi
  if (( $(date +%s) > deadline )); then
    fail "Timed out waiting for agent-host."
  fi
  sleep 3
done

# ── Step 3: Discover a map and activate a live session ────────────────────────

log "Step 3/5: Discovering maps and activating a live session…"
map_id=$(node -e "
  fetch('$SERVER_URL/maps')
    .then(r => r.json())
    .then(d => {
      const maps = Array.isArray(d) ? d : (d.maps ?? []);
      if (maps.length === 0) { process.stderr.write('No maps found\n'); process.exit(1); }
      process.stdout.write(maps[0].id ?? maps[0].mapId ?? maps[0]);
    })
    .catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); })
" 2>/dev/null) || fail "Could not list maps from $SERVER_URL/maps"

log "  Using map: $map_id"

session_id=$(node -e "
  fetch('$SERVER_URL/live', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $ADMIN_TOKEN'
    },
    body: JSON.stringify({ name: 'cold-start-test', maps: [{ mapId: '$map_id', role: 'primary' }] })
  })
    .then(r => { if (!r.ok) return r.text().then(t => { throw new Error('HTTP ' + r.status + ': ' + t); }); return r.json(); })
    .then(d => process.stdout.write(d.id ?? d.sessionId ?? ''))
    .catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); })
" 2>/dev/null) || fail "Could not activate live session"

if [[ -z "$session_id" ]]; then
  fail "POST /live returned no session ID"
fi
log "  Session activated: $session_id"

# ── Step 4: Wait for reconciliation to spawn ghosts ───────────────────────────

log "Step 4/5: Waiting for agent-host reconciliation to spawn ≥$GHOST_MIN_COUNT random-agent ghost(s)…"
deadline=$(( $(date +%s) + WAIT_TIMEOUT ))
while true; do
  ghost_count=$(node -e "
    fetch('$AGENT_HOST_URL/v1/sessions', {
      headers: { 'Authorization': 'Bearer $AGENT_HOST_TOKEN' }
    })
      .then(r => r.json())
      .then(d => {
        const sessions = d.sessions ?? [];
        const active = sessions.filter(s => s.agentId === 'random-agent' && s.status !== 'terminated');
        process.stdout.write(String(active.length));
      })
      .catch(() => process.stdout.write('0'))
  " 2>/dev/null || echo "0")

  log "  random-agent sessions active: $ghost_count"
  if (( ghost_count >= GHOST_MIN_COUNT )); then
    break
  fi
  if (( $(date +%s) > deadline )); then
    fail "Timed out waiting for ghosts. Got $ghost_count, need $GHOST_MIN_COUNT."
  fi
  sleep 5
done

# ── Step 5: Report ────────────────────────────────────────────────────────────

log "Step 5/5: Verifying session list…"
node -e "
  fetch('$AGENT_HOST_URL/v1/sessions', {
    headers: { 'Authorization': 'Bearer $AGENT_HOST_TOKEN' }
  })
    .then(r => r.json())
    .then(d => {
      const sessions = d.sessions ?? [];
      const active = sessions.filter(s => s.agentId === 'random-agent' && s.status !== 'terminated');
      console.log('[cold-start]   total sessions:', sessions.length);
      console.log('[cold-start]   random-agent active:', active.length);
      active.forEach(s => console.log('[cold-start]    ', s.ghostId, s.status));
    })
" 2>/dev/null

log ""
log "✓ PASS — ghost autospawn works after cold start."
log "  $ghost_count random-agent session(s) active after reconciliation."
