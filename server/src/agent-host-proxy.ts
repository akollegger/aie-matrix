/**
 * Exported for unit testing.
 * Returns true when the request may bypass admin-token auth on the /agent-host/ proxy.
 * GET /v1/sessions and GET /v1/catalog are public so the Intermedium spectator client
 * can resolve ghost display names without admin credentials.
 */
export function isPublicAgentHostRead(method: string, pathname: string): boolean {
  const PUBLIC_AGENT_HOST_READS = ["/agent-host/v1/sessions", "/agent-host/v1/catalog"];
  return method === "GET" && PUBLIC_AGENT_HOST_READS.some((p) => pathname === p);
}
