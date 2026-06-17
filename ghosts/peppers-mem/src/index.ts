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

// Re-export the MCP Client type so workspace consumers can take a
// client by type without pulling @modelcontextprotocol/sdk as a
// direct dependency.
export type { Client as MemoryClient } from "@modelcontextprotocol/sdk/client/index.js";

export {
  callOrThrow,
  persistCascade,
  persistCommitmentEvaluation,
  persistImpressions,
  formatStimulus as formatStimulusForTrace,
  type ImpressionWrite,
} from "./persist.js";

export {
  fetchCascadeById,
  fetchRecentCascades,
  fetchRecentDialogueWith,
  fetchRecentConversation,
  fetchRecentActionDigest,
  fetchOccupantImpressions,
  formatCascadeReplay,
  type CascadeReplay,
  type CascadeReplayStep,
  type DialogueTurn,
  type ActionDigestEntry,
  type ImpressionView,
} from "./retrieve.js";

export {
  PROCEDURE_SCHEMA,
  quickShapeCheck,
  type AipProcedure,
} from "./aip/index.js";

export {
  CONSOLIDATED_LABEL,
  ORIGINAL_LABEL,
  notConsolidated,
  relabelAsConsolidated,
  relabelManyAsConsolidated,
  createConsolidation,
  createSkill,
} from "./sleep-graph.js";
