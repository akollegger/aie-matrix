/**
 * In-process BLACKOUT consolidation — one full sleep cycle for a ghost,
 * run by calling each step function directly (no subprocess, no tsx, no
 * source scripts). This is what makes consolidation work inside the lean
 * production Docker image, where the old `spawn(node --import tsx <src.ts>)`
 * chain could not run (no tsx, no src/, bad cwd).
 *
 * Step order matches the original scripts/blackout.ts:
 *   1. embed-experience            (session)          — embed raw memory
 *   2. try-consolidate-experience  (session, commit)  — cluster → :Consolidation
 *   3. embed-consolidations        (global)           — embed consolidations
 *   4. contradict-experience       (session, commit)  — [:CONTRADICTS] edges
 *   5. pagerank-kneedle-cut        (session, commit)  — prune the noise
 *   6. distill-skills              (session, commit)  — survivors → :Skill
 *   7. narrate-self                (session, commit)  — who am I now → :SelfNarrative
 *
 * Each step is idempotent / commit-once, so a single retry on transient
 * failure is safe (mirrors the old runStep retry).
 */

import { runEmbedExperience } from "./scripts/embed-experience.js";
import { runTryConsolidateExperience } from "./scripts/try-consolidate-experience.js";
import { runEmbedConsolidations } from "./scripts/embed-consolidations.js";
import { runContradictExperience } from "./scripts/contradict-experience.js";
import { runPagerankKneedleCut } from "./scripts/pagerank-kneedle-cut.js";
import { runDistillSkills } from "./scripts/distill-skills.js";
import { runNarrateSelf } from "./scripts/narrate-self.js";

export async function runBlackout(
  ghostId: string,
  opts: { commit?: boolean; log?: (msg: string) => void } = {},
): Promise<void> {
  const commit = opts.commit ?? true;
  const log = opts.log ?? ((m: string) => console.log(m));
  const sessionId = ghostId;

  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      log(`### blackout step ${name} failed (${String(err)}) — retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5_000));
      await fn();
    }
  };

  const t0 = Date.now();
  log(`### BLACKOUT start session=${sessionId} commit=${commit}`);
  await step("embed-experience", () => runEmbedExperience({ sessionId }));
  await step("try-consolidate-experience", () =>
    runTryConsolidateExperience({ sessionId, commit }));
  await step("embed-consolidations", () => runEmbedConsolidations());
  await step("contradict-experience", () =>
    runContradictExperience({ sessionId, commit }));
  await step("pagerank-kneedle-cut", () =>
    runPagerankKneedleCut({ sessionId, commit }));
  await step("distill-skills", () => runDistillSkills({ sessionId, commit }));
  // Identity decision LAST — narrate over the survivors of the cut.
  await step("narrate-self", () => runNarrateSelf({ sessionId, commit }));
  log(
    `### BLACKOUT done session=${sessionId} in ${Math.round((Date.now() - t0) / 1000)}s`,
  );
}
