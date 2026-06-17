/**
 * The SDK's `tool({parameters: …})` generic expects a literal-typed
 * `JsonObjectSchemaNonStrict`. Our world tool schemas come dynamically
 * from MCP discovery (typed as `Record<string, unknown>`), so we cast
 * through this helper.
 *
 * The SDK doesn't re-export `JsonObjectSchemaNonStrict` from its
 * public surface; we mirror the shape (one literal `type`, literal
 * `additionalProperties: true`) so TypeScript narrows on the call
 * site without dragging an internal SDK type path into our imports.
 */

type NonStrictSchema = {
  readonly type: "object";
  readonly properties: Record<string, never>;
  readonly required: never[];
  readonly additionalProperties: true;
  readonly description?: string;
};

export function asNonStrictSchema(schema: unknown): NonStrictSchema {
  const s = (schema ?? { type: "object", properties: {}, required: [] }) as Record<string, unknown>;
  return {
    type: "object",
    properties: (s["properties"] as Record<string, never>) ?? ({} as Record<string, never>),
    required: (s["required"] as never[]) ?? ([] as never[]),
    additionalProperties: true,
    ...(typeof s["description"] === "string" ? { description: s["description"] as string } : {}),
  };
}
