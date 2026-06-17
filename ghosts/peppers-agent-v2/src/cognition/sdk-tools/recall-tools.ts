/**
 * Memory recall pull-tools as SDK `tool()` definitions. Each
 * wraps `executeMemoryTool` from `memory-tools.ts` so the
 * felt-vocabulary rendering and Step-4 gate stay in one place;
 * only the surface (SDK tool vs ad-hoc tool-loop) differs.
 */

import { tool } from "@openai/agents";

import {
  MEMORY_TOOL_SCHEMAS,
  executeMemoryTool,
  type MemoryToolContext,
} from "../../memory-tools.js";
import type { CascadeContext } from "../cascade-context.js";
import { asNonStrictSchema } from "./schema-helpers.js";

/** Build SDK recall tools, one per entry in MEMORY_TOOL_SCHEMAS. */
export function buildRecallTools() {
  return MEMORY_TOOL_SCHEMAS.map((schema) =>
    tool({
      name: schema.name,
      description: schema.description,
      parameters: asNonStrictSchema(schema.inputSchema),
      strict: false,
      execute: async (input, ctx) => {
        const cascade = ctx?.context as CascadeContext | undefined;
        const args = (input ?? {}) as Record<string, unknown>;
        if (!cascade) {
          return "(internal: no cascade context)";
        }
        const memCtx: MemoryToolContext = {
          memoryClient: cascade.memoryClient,
          selfGhostId: cascade.ghostId,
          needs: cascade.needs,
          currentCascadeIndex: cascade.currentCascadeIndex,
          knownGhosts: cascade.knownGhosts,
        };
        const output = await executeMemoryTool(schema.name, args, memCtx);
        cascade.capturedRecalls.push({
          tool: schema.name,
          args,
          output,
        });
        return output;
      },
    }),
  );
}
