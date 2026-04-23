export {
  createColyseusBridge,
  type ColyseusWorldBridge,
} from "./colyseus-bridge.js";
export {
  evaluateGo,
  evaluateTraverse,
  resolveNeighbor,
  type GhostMoveContext,
  type TraverseTargetLookup,
} from "./movement.js";
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
  AIE_MATRIX_RULES_ENV,
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
  WorldApiItemNotCarriable,
  WorldApiItemNotCarrying,
  WorldApiItemNotFound,
  WorldApiItemNotHere,
  WorldApiTileFull,
  WorldApiUnknownCell,
  type WorldApiError,
} from "./world-api-errors.js";
export { handleGhostMcpEffect } from "./mcp-server.js";
export {
  ItemService,
  ItemServiceImpl,
  makeItemServiceLayer,
  broadcastInitialItemState,
  computeTileItemCost,
} from "./ItemService.js";
export {
  getRequestTraceId,
  runWithRequestTrace,
  type RequestTrace,
} from "./request-trace.js";
export {
  CELL_H3_UNIQUE_CONSTRAINT_CYPHER,
  createNeo4jDriverFromEnv,
  ensureCellH3UniqueConstraint,
} from "./neo4j-graph-init.js";
export { seedNeo4jGraphArtifacts } from "./neo4j-graph-seed.js";
export {
  Neo4jGraphService,
  makeLiveNeo4jGraphLayer,
  makeNoOpNeo4jGraphLayer,
  type Neo4jGraphOps,
  type NonAdjacentRow,
} from "./Neo4jGraphService.js";
