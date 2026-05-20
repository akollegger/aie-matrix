/**
 * T042 / T043 — Outbound social speech
 *
 * Social agents emit `say` through the world MCP `say` tool, forwarded by this house’s MCP proxy
 * to the aie-matrix world server. The world `say` effect persists the line and calls
 * `ColyseusWorldBridge#fanoutWorldV1` so the ghost house Colyseus client (see
 * `ColyseusWorldBridge.ts`) receives `world.message.new` for nearby target ghosts.
 *
 * There is no separate A2A “say” method in the house: stream delivery is unidirectional; speech is MCP.
 */

export const SOCIAL_SPEECH_VIA_MCP_SAY = true as const;
