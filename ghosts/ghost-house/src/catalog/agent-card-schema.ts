import { z } from "zod";

/** MCP tool names the house may register against — IC-003. */
const IC003_TOOLS = new Set([
  "whereami",
  "look",
  "exits",
  "go",
  "traverse",
  "inventory",
]);

const matrixZ = z.object({
  schemaVersion: z.literal(1),
  tier: z.enum(["wanderer", "listener", "social"]),
  ghostClasses: z.array(z.string().min(1)).min(1),
  requiredTools: z.array(z.string()),
  capabilitiesRequired: z.array(z.string()),
  memoryKind: z.string(),
  llmProvider: z.string(),
  profile: z.object({ about: z.string().min(1) }),
  authors: z.array(z.string()).min(1),
});

const baseAgentCardZ = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  protocolVersion: z.literal("0.3.0"),
  version: z.string().min(1),
  url: z.string().min(1),
  capabilities: z.object({
    streaming: z.boolean(),
    pushNotifications: z.boolean(),
  }),
  skills: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        tags: z.array(z.string()).optional(),
        examples: z.array(z.unknown()).optional(),
        inputModes: z.array(z.string()).optional(),
        outputModes: z.array(z.string()).optional(),
        security: z.array(z.unknown()).optional(),
      }),
    )
    .min(1),
  defaultInputModes: z.array(z.string()).min(1),
  defaultOutputModes: z.array(z.string()).min(1),
  matrix: matrixZ,
});

function tierMatchesCapabilities(
  tier: "wanderer" | "listener" | "social",
  cap: { streaming: boolean; pushNotifications: boolean },
): boolean {
  if (tier === "wanderer") {
    return cap.streaming === true && cap.pushNotifications === false;
  }
  return cap.streaming === true && cap.pushNotifications === true;
}

function validateRequiredToolsInIc003(
  requiredTools: readonly string[],
): { ok: true } | { ok: false; unknown: string[] } {
  const unknown: string[] = [];
  for (const t of requiredTools) {
    if (!IC003_TOOLS.has(t)) {
      unknown.push(t);
    }
  }
  return unknown.length ? { ok: false, unknown } : { ok: true };
}

export function parseAndValidateAgentCard(
  data: unknown,
  fieldPrefix = "agentCard",
): { ok: true; value: z.infer<typeof baseAgentCardZ> } | { ok: false; errors: string[] } {
  const parsed = baseAgentCardZ.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map(
        (e) => `${fieldPrefix}.${e.path.length ? e.path.join(".") : "root"}: ${e.message}`,
      ),
    };
  }
  const c = parsed.data;
  if (!tierMatchesCapabilities(c.matrix.tier, c.capabilities)) {
    return {
      ok: false,
      errors: [
        `${fieldPrefix}.matrix.tier: capabilities do not match tier (IC-001: wanderer = stream true, push false; listener/social = both true)`,
      ],
    };
  }
  const toolCheck = validateRequiredToolsInIc003(c.matrix.requiredTools);
  if (!toolCheck.ok) {
    return {
      ok: false,
      errors: [`${fieldPrefix}.matrix.requiredTools: unknown tools: ${toolCheck.unknown.join(", ")}`],
    };
  }
  return { ok: true, value: c };
}

export function isUrlSafeAgentId(id: string): boolean {
  if (id.length === 0) {
    return false;
  }
  if (id.includes("/") || id.includes("?") || id.includes("#")) {
    return false;
  }
  return /^[a-zA-Z0-9._~-]+$/.test(id);
}
