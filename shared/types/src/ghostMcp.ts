import type { Compass, LookAt } from "./compass.js";

export const GHOST_MCP_TOOLS = [
  "whoami",
  "whereami",
  "look",
  "exits",
  "go",
  "traverse",
] as const;

export type GhostMcpTool = (typeof GHOST_MCP_TOOLS)[number];

export interface WhoAmIResult {
  ghostId: string;
  caretakerId: string;
}

export interface WhereAmIResult {
  /** Canonical H3 res-15 cell id. */
  h3Index: string;
  /** Same as `h3Index` — retained for agents that still read `tileId`. */
  tileId: string;
  col: number;
  row: number;
}

export interface LookArgs {
  /** Defaults to `here` when omitted. */
  at?: LookAt;
}

export interface TileInspectResult {
  tileId: string;
  tileClass: string;
  occupants: string[];
  properties?: Record<string, string>;
}

export interface ExitInfo {
  toward: Compass;
  tileId: string;
}

/** Named non-adjacent exit from Neo4j (IC-006). */
export interface NonAdjacentExitInfo {
  kind: "ELEVATOR" | "PORTAL";
  name: string;
  /** Destination H3 res-15 index. */
  tileId: string;
  tileClass: string;
}

export interface TraverseSuccess {
  ok: true;
  via: string;
  from: string;
  to: string;
  tileClass: string;
}

export type TraverseFailure =
  | { ok: false; code: "NO_EXIT"; reason: string }
  | { ok: false; code: "UNKNOWN_CELL"; reason: string }
  | { ok: false; code: "RULESET_DENY"; reason: string };

export type TraverseResult = TraverseSuccess | TraverseFailure;

/** Machine-stable `code` values on {@link GoFailure} from the `go` tool (IC-003). */
export const GO_MOVEMENT_FAILURE_CODES = [
  "UNKNOWN_CELL",
  "NO_NEIGHBOR",
  "MAP_INTEGRITY",
  "RULESET_DENY",
] as const;

export type GoMovementFailureCode = (typeof GO_MOVEMENT_FAILURE_CODES)[number];

export interface GoArgs {
  toward: Compass;
}

export interface GoSuccess {
  ok: true;
  tileId: string;
}

export interface GoFailure {
  ok: false;
  reason: string;
  /** Machine-stable code for TCK / agents. */
  code: string;
}

export type GoResult = GoSuccess | GoFailure;
