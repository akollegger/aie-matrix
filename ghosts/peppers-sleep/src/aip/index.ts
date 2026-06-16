/**
 * AIP (Agent Instruction Protocol) integration.
 *
 * Vendored schema from `zach-blumenfeld/aip` v0.3a3
 * (`assets/aip-schemas/procedure.schema.json`). We use AIP's
 * procedure schema as the authoring target for sleep-pipeline Skill
 * generation: the large-model call at step 12 of the consolidation
 * pipeline emits AIP-conformant procedure data, which we persist as
 * a `:Skill` node alongside the ghost's other memory.
 *
 * For conformance at write-time we rely on OpenAI Responses API's
 * `response_format: {type: "json_schema"}` — the model is forced to
 * emit valid procedure JSON. We convert JSON → YAML for storage in
 * line with AIP's intended on-disk shape.
 *
 * Upstream:
 *   - https://github.com/zach-blumenfeld/aip
 *   - https://arxiv.org/abs/2606.04781 (Blumenfeld & Webber)
 *   - https://agentskills.io/home (Agent Skills Spec, which AIP extends)
 *
 * To resync the schema:
 *   curl -fsSL \
 *     https://raw.githubusercontent.com/zach-blumenfeld/aip/main/assets/aip-schemas/procedure.schema.json \
 *     > ghosts/peppers-mem/src/aip/procedure.schema.json
 *
 * Bump the pinned version comment above when you do.
 */

import procedureSchema from "./procedure.schema.json" with { type: "json" };

/**
 * The vendored AIP procedure JSON Schema. Pass as
 * `response_format.json_schema.schema` to the OpenAI Responses API
 * to force conformant output at generation time.
 */
export const PROCEDURE_SCHEMA: Readonly<Record<string, unknown>> =
  procedureSchema as unknown as Readonly<Record<string, unknown>>;

/**
 * Minimal TypeScript view of an AIP procedure — the fields the
 * consolidation pipeline reads at cascade-match time. The full schema
 * lives in `procedure.schema.json`; this type covers what our code
 * actually inspects (trigger matching, do-not-use suppression, step
 * injection). New fields can be read directly from the stored JSON
 * without expanding this type.
 */
export interface AipProcedure {
  /** One-paragraph scope statement for the procedure. */
  readonly purpose: string;
  /** Conditions under which this procedure should be considered. */
  readonly trigger_when: ReadonlyArray<string>;
  /** Optional conditions under which this procedure should NOT be used. */
  readonly do_not_use_when?: ReadonlyArray<string>;
  /** Optional scope-and-approval narrative. */
  readonly scope_and_approval?: string;
  /** Ordered procedure steps. Shape is loose at this layer; the
   *  authoring stage produces structures the schema validates. */
  readonly steps: ReadonlyArray<Record<string, unknown>>;
  /** Other optional procedure-schema fields, passed through verbatim. */
  readonly modes?: ReadonlyArray<unknown>;
  readonly search_shortcuts?: ReadonlyArray<unknown>;
  readonly integrations?: ReadonlyArray<unknown>;
  readonly scenarios?: ReadonlyArray<unknown>;
  readonly anti_patterns?: ReadonlyArray<unknown>;
}

/**
 * Lightweight shape check — verifies the three required fields are
 * present and well-typed. Not a full JSON Schema validation; that's
 * the LLM's job (via `response_format: {type: "json_schema"}`) when
 * the procedure is generated, and AIP's Python validator's job if
 * we run that as a quality gate downstream.
 *
 * Returns `null` if the candidate looks well-formed enough to
 * persist as a Skill; returns a short reason otherwise.
 */
export function quickShapeCheck(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") {
    return "not an object";
  }
  const c = candidate as Record<string, unknown>;
  if (typeof c.purpose !== "string" || c.purpose.length === 0) {
    return "missing or empty `purpose`";
  }
  if (!Array.isArray(c.trigger_when) || c.trigger_when.length === 0) {
    return "missing or empty `trigger_when`";
  }
  if (c.trigger_when.some((t) => typeof t !== "string")) {
    return "`trigger_when` must be an array of strings";
  }
  if (!Array.isArray(c.steps) || c.steps.length === 0) {
    return "missing or empty `steps`";
  }
  return null;
}
