/**
 * `speak` — the Id's speech GATE.
 *
 * The Id never produces words. It decides ONE thing per cascade: whether the
 * Surface is allowed to speak this turn. Calling this tool grants that
 * permission (idempotent — a second call changes nothing). After the Id run,
 * if permission was granted, the run-loop runs the Surface ONCE; the Surface
 * sees the conversation directly and composes the actual utterance from its own
 * external-expression sliders. No intent, no words, no addressee are dictated
 * here — the Id only opens the gate.
 *
 * This replaces the old `voice_surface` tool, which let the Id render AND submit
 * speech (repeatedly) from an Id-chosen intent — the source of the
 * over-speaking / re-introduction / self-contradiction spiral.
 */

import { tool } from "@openai/agents";

import type { CascadeContext } from "../cascade-context.js";
import { asNonStrictSchema } from "./schema-helpers.js";

export function buildSpeakGateTool() {
  return tool({
    name: "speak",
    description:
      "Choose to speak aloud this turn. You decide ONLY whether to speak — your outward voice composes the actual words from how you're coming across right now and the conversation in front of you. Optionally name who you mean to address.",
    parameters: asNonStrictSchema({
      type: "object",
      properties: {
        addressee: {
          type: "string",
          description: "Optional: the display name of whoever you mean to speak to.",
        },
      },
      required: [],
    }),
    strict: false,
    execute: async (input, ctx) => {
      const cascade = ctx?.context as CascadeContext | undefined;
      if (!cascade) return "(internal: no cascade context)";
      cascade.speakRequested = true;
      const addressee = (input as { addressee?: unknown } | null)?.addressee;
      if (typeof addressee === "string" && addressee.trim().length > 0) {
        cascade.speakAddressee = addressee.trim();
      }
      // The words don't exist yet — the Surface composes them after this run.
      return "(you'll speak this turn; your outward voice will choose the words)";
    },
  });
}
