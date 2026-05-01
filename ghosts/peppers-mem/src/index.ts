/**
 * @aie-matrix/ghost-peppers-mem
 *
 * Adapter package between our TS ghost code and the Python-only
 * Neo4j Agent Memory package, bridged via its MCP server. Exposes a
 * thin typed wrapper around the MCP `Client`. Tool surface is
 * discovered at runtime; tool-specific helpers will land here as the
 * house runner needs them.
 */

export {
  connectMemory,
  type MemoryClientHandle,
  type MemoryClientOptions,
  type MemoryConnection,
} from "./client.js";

export { callOrThrow, persistCascade } from "./persist.js";

export {
  fetchCascadeById,
  fetchRecentCascades,
  formatCascadeReplay,
  type CascadeReplay,
  type CascadeReplayStep,
} from "./retrieve.js";
