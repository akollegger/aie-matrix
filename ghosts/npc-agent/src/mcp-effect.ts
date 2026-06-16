import { Context, Effect, Layer } from "effect";
import {
  GhostMcpClient,
  type WhereAmIResult, type ExitsResult, type LookArgs, type LookResult,
  type GoArgs, type GoResult, type TakeArgs, type TakeResult,
  type InventoryResult, type TraverseResult,
  type SayArgs, type SayResult, type InboxResult,
} from "@aie-matrix/ghost-ts-client";
import { McpCallError } from "./errors.js";

// ── Eval-contract MCP tool types (world-api extension, not in GHOST_MCP_TOOLS) ─

export interface EvalContractOpenArgs {
  readonly contractorId: string;
  readonly evaluatorId: string;
  readonly request: string;
  readonly stakeResource: string;
  readonly stakeAmount: number;
  readonly deadlineMs: number;
  readonly artifactRef?: string;
  readonly disclosureRef?: string;
}

export type EvalContractOpenResult =
  | { readonly contractId: string }
  | { readonly code: string; readonly message?: string };

export interface EvalContractEvaluateArgs {
  readonly contractId: string;
  readonly verdict: number;
}

export interface EvalContractEvaluateResult {
  readonly ok: boolean;
}

// ── Service interface ─────────────────────────────────────────────────────────

export interface GhostMcpServiceShape {
  readonly whereami: Effect.Effect<WhereAmIResult, McpCallError>;
  readonly exits: Effect.Effect<ExitsResult, McpCallError>;
  readonly look: (args?: LookArgs) => Effect.Effect<LookResult, McpCallError>;
  readonly go: (args: GoArgs) => Effect.Effect<GoResult, McpCallError>;
  readonly take: (args: TakeArgs) => Effect.Effect<TakeResult, McpCallError>;
  readonly traverse: (args: { via: string }) => Effect.Effect<TraverseResult, McpCallError>;
  readonly inventory: Effect.Effect<InventoryResult, McpCallError>;
  readonly say: (args: SayArgs) => Effect.Effect<SayResult, McpCallError>;
  readonly inbox: Effect.Effect<InboxResult, McpCallError>;
  readonly evalContractOpen: (args: EvalContractOpenArgs) => Effect.Effect<EvalContractOpenResult, McpCallError>;
  readonly evalContractEvaluate: (args: EvalContractEvaluateArgs) => Effect.Effect<EvalContractEvaluateResult, McpCallError>;
}

// ── Context.Tag ───────────────────────────────────────────────────────────────

export class GhostMcpService extends Context.Tag("GhostMcpService")<
  GhostMcpService,
  GhostMcpServiceShape
>() {}

// ── Layer ─────────────────────────────────────────────────────────────────────

function wrap<A>(fn: () => Promise<A>, toolName: string): Effect.Effect<A, McpCallError> {
  return Effect.tryPromise({
    try: fn,
    catch: (cause) => new McpCallError({ tool: toolName, cause }),
  });
}

export const GhostMcpServiceLive = (client: GhostMcpClient): Layer.Layer<GhostMcpService> =>
  Layer.succeed(GhostMcpService, {
    whereami:   wrap(() => client.whereami(), "whereami"),
    exits:      wrap(() => client.exits(), "exits"),
    look:       (args) => wrap(() => client.look(args), "look"),
    go:         (args) => wrap(() => client.go(args), "go"),
    take:       (args) => wrap(() => client.take(args), "take"),
    traverse:   (args) => wrap(() => client.traverse(args), "traverse"),
    inventory:  wrap(() => client.inventory(), "inventory"),
    say:        (args) => wrap(() => client.say(args), "say"),
    inbox:      wrap(() => client.inbox(), "inbox"),
    evalContractOpen: (args) => wrap(
      () => client.callTool("eval_contract_open", args as unknown as Record<string, unknown>) as Promise<EvalContractOpenResult>,
      "eval_contract_open",
    ),
    evalContractEvaluate: (args) => wrap(
      () => client.callTool("eval_contract_evaluate", args as unknown as Record<string, unknown>) as Promise<EvalContractEvaluateResult>,
      "eval_contract_evaluate",
    ),
  });
