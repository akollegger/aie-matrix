import {
  ActiveSessionsPreventDeregister,
  AgentAlreadyRegistered,
  AgentCardFetchFailed,
  AgentCardInvalid,
  AgentNotFound,
  CapabilityUnmet,
  McpToolRejected,
  SessionNotFound,
  SpawnFailed,
  SpawnTimeout,
  Unauthorized,
} from "./errors.js";

type ErrBody = { error: string; code: string };

export function mapHouseError(e: unknown): { status: number; body: ErrBody } {
  if (e instanceof Unauthorized) {
    return { status: 401, body: { error: e.message, code: "UNAUTHORIZED" } };
  }
  if (e instanceof AgentCardInvalid) {
    return { status: 400, body: { error: e.message, code: "VALIDATION_FAILED" } };
  }
  if (e instanceof AgentAlreadyRegistered) {
    return { status: 409, body: { error: `agent ${e.agentId} is already registered`, code: "ALREADY_REGISTERED" } };
  }
  if (e instanceof AgentCardFetchFailed) {
    return {
      status: 502,
      body: { error: `could not fetch agent card: ${e.message}`, code: "AGENT_CARD_FETCH_FAILED" },
    };
  }
  if (e instanceof AgentNotFound) {
    return { status: 404, body: { error: `unknown agent ${e.agentId}`, code: "NOT_FOUND" } };
  }
  if (e instanceof SpawnFailed) {
    return { status: 503, body: { error: e.message, code: "AGENT_UNREACHABLE" } };
  }
  if (e instanceof SpawnTimeout) {
    return { status: 503, body: { error: e.message, code: "AGENT_UNREACHABLE" } };
  }
  if (e instanceof CapabilityUnmet) {
    return {
      status: 422,
      body: { error: `missing capabilities: ${e.missing.join(", ")}`, code: "CAPABILITY_UNMET" },
    };
  }
  if (e instanceof ActiveSessionsPreventDeregister) {
    return {
      status: 409,
      body: { error: `${e.count} active session(s) for ${e.agentId}`, code: "ACTIVE_SESSIONS" },
    };
  }
  if (e instanceof McpToolRejected) {
    return { status: 403, body: { error: e.message, code: "MCP_TOOL_REJECTED" } };
  }
  if (e instanceof SessionNotFound) {
    return { status: 404, body: { error: `session ${e.sessionId}`, code: "NOT_FOUND" } };
  }
  return { status: 500, body: { error: e instanceof Error ? e.message : String(e), code: "INTERNAL" } };
}
