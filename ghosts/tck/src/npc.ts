/**
 * NPC Agent TCK harness (T031 / SC-007, SC-008).
 *
 * Validates:
 *   (a) Single multi-turn dialog: external ghost sends "hello" → "when is the keynote" → "thanks"
 *       and the NPC replies with the expected responses from info-attendant.character.gram.
 *   (b) Two interleaved conversations: two external ghosts both message the same NPC simultaneously;
 *       their per-partner dialog state is tracked independently with no cross-contamination.
 *
 * Requires:
 *   - Combined server running (world-api + registry + agent-host)
 *   - npc-agent running with NPC_AGENT_BASE_URL set (default http://127.0.0.1:4004)
 *   - npc-agent must have at least the info-attendant character (enabled: true, greeting dialog)
 *   - AIE_MATRIX_INTERNAL_FANOUT_TOKEN env var
 */
import { loadRootEnv } from "@aie-matrix/root-env";

loadRootEnv();

const registryBase = (process.env.AIE_MATRIX_REGISTRY_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const houseBase = (process.env.AGENT_HOST_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
const worldHttpBase = (process.env.AIE_MATRIX_HTTP_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const npcBase = (process.env.NPC_AGENT_BASE_URL ?? "http://127.0.0.1:4004").replace(/\/$/, "");
const devToken = process.env.AGENT_HOST_TOKEN ?? "dev-secret-change-me";
const fanoutToken = process.env.AIE_MATRIX_INTERNAL_FANOUT_TOKEN ?? "";

// Ghost ids used as senders in fanout messages (simulating external ghosts).
const EXTERNAL_GHOST_A = process.env.AIE_MATRIX_TCK_PARTNER_GHOST ?? "01JARPPARTNER000TCK000TCK0000";
const EXTERNAL_GHOST_B = "01JARPPARTNER000TCK000TCK0001";

function fail(step: string, message: string, cause?: unknown): never {
  const extra = cause !== undefined ? ` ${cause instanceof Error ? cause.message : String(cause)}` : "";
  console.error(`[tck:npc] ${step} FAILED:${extra}`);
  console.error(`[tck:npc] ${step} ${message}`);
  return process.exit(1) as never;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`fetch ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Non-JSON (${res.status}): ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return data as T;
}

function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return getJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function fanout(targetGhostId: string, fromGhostId: string, text: string, priority = "DIRECT"): Promise<void> {
  const res = await fetch(`${worldHttpBase}/internal/world-fanout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${fanoutToken}`,
    },
    body: JSON.stringify({
      t: "message.new",
      targetGhostId,
      payload: { from: fromGhostId, priority, text },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fanout HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** Poll the _tck/dialog endpoint until the state key matches expected nodeId or timeout. */
async function waitForDialogState(
  characterGhostId: string,
  partnerGhostId: string,
  expectedNodeId: string,
  timeoutMs = 15_000,
): Promise<void> {
  const key = `${characterGhostId}:${partnerGhostId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await getJson<Record<string, { currentNodeId?: string }>>(
        `${npcBase}/_tck/dialog`,
        { headers: { authorization: `Bearer ${devToken}` } },
      );
      if (state[key]?.currentNodeId === expectedNodeId) return;
    } catch {
      // agent not yet ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const state = await getJson<Record<string, { currentNodeId?: string }>>(
    `${npcBase}/_tck/dialog`,
    { headers: { authorization: `Bearer ${devToken}` } },
  ).catch(() => ({}));
  const got = (state as Record<string, { currentNodeId?: string }>)[key]?.currentNodeId ?? "(not found)";
  throw new Error(
    `Timeout waiting for dialog state key="${key}" to reach nodeId="${expectedNodeId}"; got="${got}"`,
  );
}

async function stepValidateAgentCard(): Promise<void> {
  const card = await getJson<{
    protocolVersion?: string;
    matrix?: { llmProvider?: string; worldEventSubscriptions?: string[] };
    capabilities?: { pushNotifications?: boolean };
  }>(`${npcBase}/.well-known/agent-card.json`);

  if (card.protocolVersion !== "0.3.0") {
    fail("agent-card", `expected protocolVersion 0.3.0, got ${String(card.protocolVersion)}`);
  }
  if (card.matrix?.llmProvider !== "none") {
    fail("agent-card", `expected llmProvider "none", got ${String(card.matrix?.llmProvider)}`);
  }
  if (!card.matrix?.worldEventSubscriptions?.includes("world.session.start")) {
    fail("agent-card", "missing world.session.start subscription");
  }
  if (!card.matrix?.worldEventSubscriptions?.includes("world.message.new")) {
    fail("agent-card", "missing world.message.new subscription");
  }
  if (card.capabilities?.pushNotifications !== true) {
    fail("agent-card", "pushNotifications must be true");
  }
  console.error("[tck:npc] agent-card ok");
}

async function stepRegisterNpcAgent(): Promise<void> {
  try {
    await getJson(`${houseBase}/v1/catalog/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${devToken}`,
      },
      body: JSON.stringify({ agentId: "npc-agent", baseUrl: npcBase }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("409") && !msg.includes("already")) {
      fail("register", "catalog register failed", e);
    }
  }
  console.error("[tck:npc] registered ok");
}

type AdoptResult = { ghostId: string; credential: { token: string; worldApiBaseUrl: string } };
type SpawnResult = { sessionId: string; ghostId: string };

async function stepSpawnNpcCharacter(): Promise<{ npcGhostId: string; sessionId: string }> {
  const { agentHostId } = await postJson<{ agentHostId: string }>(
    `${registryBase}/registry/houses`,
    { displayName: "tck-npc-house" },
  );
  const { caretakerId } = await postJson<{ caretakerId: string }>(
    `${registryBase}/registry/caretakers`,
    { label: "tck-npc" },
  );
  const adopt = await postJson<AdoptResult>(
    `${registryBase}/registry/adopt`,
    { caretakerId, agentHostId },
  );

  const spawn = await getJson<SpawnResult>(`${houseBase}/v1/sessions/spawn/npc-agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${devToken}`,
    },
    body: JSON.stringify({
      ghostId: adopt.ghostId,
      credential: {
        token: adopt.credential.token,
        worldApiBaseUrl: adopt.credential.worldApiBaseUrl,
      },
    }),
  });

  console.error(
    `[tck:npc] spawned npc ghost ghostId=${spawn.ghostId.slice(0, 8)}… sessionId=${spawn.sessionId.slice(0, 8)}…`,
  );
  return { npcGhostId: spawn.ghostId, sessionId: spawn.sessionId };
}

/** SC-007: Single multi-turn dialog through greeting → schedule → farewell. */
async function stepSingleTurnDialog(npcGhostId: string): Promise<void> {
  if (fanoutToken.length === 0) {
    fail("sc-007", "AIE_MATRIX_INTERNAL_FANOUT_TOKEN is required");
  }

  // Turn 1: "hello"
  await fanout(npcGhostId, EXTERNAL_GHOST_A, "hello");
  await waitForDialogState(npcGhostId, EXTERNAL_GHOST_A, "schedule");
  console.error("[tck:npc] sc-007 turn-1 (hello → schedule) ok");

  // Turn 2: "when does the keynote start"
  await fanout(npcGhostId, EXTERNAL_GHOST_A, "when does the keynote start");
  await waitForDialogState(npcGhostId, EXTERNAL_GHOST_A, "farewell");
  console.error("[tck:npc] sc-007 turn-2 (schedule → farewell) ok");

  // Turn 3: "thanks"
  await fanout(npcGhostId, EXTERNAL_GHOST_A, "thanks");
  await waitForDialogState(npcGhostId, EXTERNAL_GHOST_A, "farewell");
  console.error("[tck:npc] sc-007 turn-3 (farewell → farewell) ok");
}

/** SC-008: Two interleaved conversations with independent state tracking. */
async function stepInterleavedDialogs(npcGhostId: string): Promise<void> {
  if (fanoutToken.length === 0) {
    fail("sc-008", "AIE_MATRIX_INTERNAL_FANOUT_TOKEN is required");
  }

  // Ghost A and Ghost B both say "hello" — each should track independently.
  await fanout(npcGhostId, EXTERNAL_GHOST_A, "hello");
  await fanout(npcGhostId, EXTERNAL_GHOST_B, "hi");

  // Both should advance to "schedule" independently.
  await waitForDialogState(npcGhostId, EXTERNAL_GHOST_A, "schedule");
  await waitForDialogState(npcGhostId, EXTERNAL_GHOST_B, "schedule");
  console.error("[tck:npc] sc-008 both partners at schedule ok");

  // Only Ghost A asks about the schedule.
  await fanout(npcGhostId, EXTERNAL_GHOST_A, "when is the talk");
  await waitForDialogState(npcGhostId, EXTERNAL_GHOST_A, "farewell");

  // Ghost B should still be at "schedule" (no cross-contamination).
  const stateSnapshot = await getJson<Record<string, { currentNodeId?: string }>>(
    `${npcBase}/_tck/dialog`,
    { headers: { authorization: `Bearer ${devToken}` } },
  );
  const keyB = `${npcGhostId}:${EXTERNAL_GHOST_B}`;
  const nodeBNow = stateSnapshot[keyB]?.currentNodeId;
  if (nodeBNow !== "schedule") {
    fail(
      "sc-008",
      `Ghost B state should still be "schedule" but got "${String(nodeBNow)}" — state cross-contamination`,
    );
  }
  console.error("[tck:npc] sc-008 independent state confirmed ok");
}

async function main(): Promise<void> {
  console.error(`[tck:npc] npc=${npcBase} house=${houseBase} registry=${registryBase}`);

  await stepValidateAgentCard();
  await stepRegisterNpcAgent();
  const { npcGhostId, sessionId } = await stepSpawnNpcCharacter();

  // Allow the npc-agent time to receive its spawn context and start action loops.
  await new Promise((r) => setTimeout(r, 2_000));

  await stepSingleTurnDialog(npcGhostId);
  await stepInterleavedDialogs(npcGhostId);

  // Cleanup.
  try {
    await fetch(`${houseBase}/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${devToken}` },
    });
  } catch {
    /* best effort */
  }

  console.error("[tck:npc] PASS");
}

void main().catch((e) => fail("fatal", String(e), e));
