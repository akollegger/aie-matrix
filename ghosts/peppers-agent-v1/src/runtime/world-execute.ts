/**
 * Real-world `ExecuteAction` adapter — forwards the chosen tool to
 * the MCP client generically. With genuine tool-call discovery
 * (Surface picks from the live `tools/list` menu), the action's
 * `kind` is the tool name as the server registered it, and the
 * remaining fields ARE the tool's input arguments. No per-tool
 * switch is needed; any tool the server exposes can be called.
 */

import type { GhostMcpClient } from "@aie-matrix/ghost-ts-client";

import type {
  ActionOutcome,
  SurfaceAction,
} from "@aie-matrix/ghost-peppers-inner";

import type { ExecuteAction } from "../run-loop.js";

/** Build an `ExecuteAction` bound to a connected MCP client. */
export function executeViaMcp(client: GhostMcpClient): ExecuteAction {
  return async (action) => callOne(client, action);
}

async function callOne(client: GhostMcpClient, action: SurfaceAction): Promise<ActionOutcome> {
  const { kind, ...args } = action;
  try {
    const raw = await client.callTool(kind, args as Record<string, unknown>);
    // For `say`, the world-api returns SayResult { message_id, mx_listeners }.
    // Surfacing the listener count in the outcome makes it obvious whether
    // anyone was actually in cluster range when we spoke.
    if (kind === "say" && raw && typeof raw === "object" && "mx_listeners" in raw) {
      const listeners = (raw as { mx_listeners?: unknown }).mx_listeners;
      const count = Array.isArray(listeners) ? listeners.length : 0;
      return { ok: true, data: { mx_listener_count: count, ...(raw as Record<string, unknown>) } };
    }
    if (raw && typeof raw === "object" && "ok" in raw) {
      return raw as ActionOutcome;
    }
    return { ok: true, data: raw };
  } catch (err) {
    return failureFromError(err);
  }
}

/**
 * The world-api MCP throws Errors carrying a JSON body for structured
 * denials (RULESET_DENY, TILE_FULL, NOT_HERE, etc.). Try to parse;
 * fall back to a generic ERROR outcome.
 */
function failureFromError(err: unknown): ActionOutcome {
  const msg = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(msg);
    if (parsed && typeof parsed === "object") {
      const code = typeof (parsed as { code?: unknown }).code === "string"
        ? (parsed as { code: string }).code
        : "ERROR";
      const reason = typeof (parsed as { reason?: unknown }).reason === "string"
        ? (parsed as { reason: string }).reason
        : msg;
      return { ok: false, code, reason };
    }
  } catch {
    /* fallthrough */
  }
  return { ok: false, code: "ERROR", reason: msg };
}
