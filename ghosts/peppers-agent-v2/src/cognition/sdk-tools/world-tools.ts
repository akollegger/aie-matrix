/**
 * Wrap world MCP tools as SDK `tool()` definitions. Each wrapper
 * takes the tool's discovered schema, builds an SDK FunctionTool
 * whose `execute` calls `ctx.mcp.callTool(name, args)`, normalises
 * the result, and pushes a CapturedAction into the cascade context
 * for later capture-log inclusion.
 *
 * The world's `say` tool is replaced by `voice_surface` (separate
 * file) — the Id never calls `say` directly because it doesn't
 * write the actual sentence; voice rendering happens through the
 * Surface.
 */

import { tool } from "@openai/agents";

import type { SurfaceAction } from "@aie-matrix/ghost-peppers-inner";

import type { ToolSchema } from "../../llm-client.js";
import type { CascadeContext } from "../cascade-context.js";
import { asNonStrictSchema } from "./schema-helpers.js";

const SAY_TOOL_NAME = "say";

/**
 * Build SDK tools from the world's MCP tool list. `say` is filtered
 * out — voice_surface is the entry point for speech.
 */
export function buildWorldTools(worldTools: ReadonlyArray<ToolSchema>) {
  return worldTools
    .filter((t) => t.name !== SAY_TOOL_NAME)
    .map((t) => wrapWorldTool(t));
}

function wrapWorldTool(schema: ToolSchema) {
  return tool({
    name: schema.name,
    description: schema.description,
    parameters: asNonStrictSchema(schema.inputSchema),
    strict: false,
    execute: async (input, ctx) => {
      const args = (input ?? {}) as Record<string, unknown>;
      const cascade = ctx?.context as CascadeContext | undefined;
      if (!cascade) {
        return { error: "internal: no cascade context" };
      }
      const action = { kind: schema.name, ...args } as SurfaceAction;
      try {
        const result = await cascade.mcp.callTool(schema.name, args);
        const outcome = stringifyOutcome(result);
        cascade.capturedActions.push({
          action,
          outcome,
          ok: isOk(result),
          // Keep the structured result alongside the truncated string: the
          // substrate credits needs (e.g. Fuel from `consume`'s `consumed`)
          // off this, never off the lossy `outcome` log line.
          result,
        });
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        cascade.capturedActions.push({
          action,
          outcome: `(world error: ${message})`,
          ok: false,
        });
        return { error: message };
      }
    },
  });
}

function stringifyOutcome(result: unknown): string {
  if (result === null || result === undefined) return "(no result)";
  if (typeof result === "string") return result.slice(0, 200);
  try {
    return JSON.stringify(result).slice(0, 200);
  } catch {
    return "(unserializable result)";
  }
}

function isOk(result: unknown): boolean {
  if (result === null || typeof result !== "object") return true;
  const r = result as Record<string, unknown>;
  if (typeof r["ok"] === "boolean") return r["ok"] as boolean;
  if (typeof r["error"] === "string") return false;
  return true;
}
