export {
  createColyseusBridge,
  type ColyseusWorldBridge,
} from "./colyseus-bridge.js";
export { evaluateGo, resolveNeighbor, type GhostMoveContext } from "./movement.js";
export {
  MovementRulesService,
  makeMovementRulesLayer,
  permissiveRuleset,
  authoredRuleset,
  type ParsedRuleset,
  type RulesMode,
} from "./rules/movement-rules-service.js";
export {
  RuleGraph,
  isRelationshipPattern,
  fromNode,
  toNode,
  relSubject,
  subjectLabels,
  type RelationshipPattern,
} from "./rules/rule-graph.js";
export {
  loadMovementRulesFromEnv,
  AIE_MATRIX_RULES_MODE_ENV,
  AIE_MATRIX_RULES_PATH_ENV,
} from "./rules/load-movement-rules.js";
export {
  authenticateGhostRequest,
  authenticateGhostRequestEffect,
  ghostIdsFromAuth,
  ghostIdsFromAuthEffect,
  requireGhostAuth,
  requireGhostAuthEffect,
} from "./auth-context.js";
export {
  AuthExpiredToken,
  AuthInvalidToken,
  AuthMalformedClaims,
  AuthMissingCredentials,
  type AuthError,
} from "./auth-errors.js";
export { McpHandlerError } from "./mcp-handler-error.js";
export {
  WorldBridgeNoNavigableCells,
  WorldBridgeNotReady,
  type WorldBridgeError,
} from "./world-bridge-errors.js";
export { WorldBridgeService, makeWorldBridgeLayer } from "./WorldBridgeService.js";
export {
  RegistryStoreService,
  makeRegistryStoreLayer,
} from "./RegistryStoreService.js";
export type {
  CaretakerRecord,
  GhostHouseRecord,
  GhostRecord,
  RegistryStoreLike,
} from "./registry-store-model.js";
export {
  WorldApiMapIntegrity,
  WorldApiMovementBlocked,
  WorldApiNoPosition,
  WorldApiUnknownCell,
  type WorldApiError,
} from "./world-api-errors.js";
export { handleGhostMcpEffect } from "./mcp-server.js";
export {
  getRequestTraceId,
  runWithRequestTrace,
  type RequestTrace,
} from "./request-trace.js";
