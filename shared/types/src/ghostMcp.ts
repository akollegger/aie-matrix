import type { Compass, LookAt } from "./compass.js";

export const GHOST_MCP_TOOLS = [
  "whoami",
  "whereami",
  "look",
  "exits",
  "go",
] as const;

export type GhostMcpTool = (typeof GHOST_MCP_TOOLS)[number];

export interface WhoAmIResult {
  ghostId: string;
  caretakerId: string;
}

export interface WhereAmIResult {
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
  code?: string;
}

export type GoResult = GoSuccess | GoFailure;
