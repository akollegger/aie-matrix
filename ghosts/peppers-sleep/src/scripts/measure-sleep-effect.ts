/**
 * Step F verdict — compare a slept SUBJECT ghost against a CONTROL
 * ghost from the same lab run.
 *
 *   pnpm --filter @aie-matrix/ghost-peppers-sleep run measure:sleep-effect -- \
 *       --subject=<sid> --control=<sid> --split-cascade=N
 *
 * Behavioural acceptance criterion (OVERNIGHT-SPEC §7): for at least
 * one stimulus class with n ≥ 3 in BOTH the subject's windows:
 *   - subject post-sleep entropy ≥30% below its pre-sleep entropy, OR
 *     a qualitative switch from spread-over-4+ actions to 1-2 actions
 *   - AND subject post-sleep entropy below the control's same-period
 *     (post-split) entropy on that class.
 */

import { loadRootEnv } from "@aie-matrix/root-env";

import { openSessionFromEnv } from "../graph/connection.js";
import {
  distributionsByClass,
  loadStimulusActionRows,
  type ClassDistribution,
  type StimulusActionRow,
} from "../pipeline/entropy.js";

loadRootEnv();

interface Args {
  readonly subject: string;
  readonly control: string;
  readonly splitCascade: number;
}

function parseArgs(): Args {
  let subject: string | null = null;
  let control: string | null = null;
  let splitCascade: number | null = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--subject=")) subject = arg.slice("--subject=".length);
    else if (arg.startsWith("--control=")) control = arg.slice("--control=".length);
    else if (arg.startsWith("--split-cascade="))
      splitCascade = Number(arg.slice("--split-cascade=".length));
  }
  if (subject === null || control === null || splitCascade === null) {
    throw new Error("--subject=<sid> --control=<sid> --split-cascade=N all required");
  }
  return { subject, control, splitCascade };
}

function windows(
  rows: ReadonlyArray<StimulusActionRow>,
  split: number,
): { before: StimulusActionRow[]; after: StimulusActionRow[] } {
  const before = rows.filter((r) => r.cascadeIndex >= 0 && r.cascadeIndex < split);
  const after = rows.filter((r) => r.cascadeIndex >= split);
  return { before, after };
}

function byClass(ds: ClassDistribution[]): Map<string, ClassDistribution> {
  return new Map(ds.map((d) => [d.stimulusClass, d]));
}

function concentrated(d: ClassDistribution): boolean {
  return d.counts.size <= 2;
}

function spread(d: ClassDistribution): boolean {
  return d.counts.size >= 4;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`# subject: ${args.subject}`);
  console.log(`# control: ${args.control}`);
  console.log(`# split:   cascade ${args.splitCascade}`);

  const { session, close } = await openSessionFromEnv();
  try {
    const subjRows = await loadStimulusActionRows(session, args.subject);
    const ctrlRows = await loadStimulusActionRows(session, args.control);
    const subj = windows(subjRows, args.splitCascade);
    const ctrl = windows(ctrlRows, args.splitCascade);

    const subjBefore = byClass(distributionsByClass(subj.before));
    const subjAfter = byClass(distributionsByClass(subj.after));
    const ctrlAfter = byClass(distributionsByClass(ctrl.after));

    console.log(
      `# subject cascades: ${subj.before.length} before / ${subj.after.length} after`,
    );
    console.log(
      `# control cascades: ${ctrl.before.length} before / ${ctrl.after.length} after`,
    );

    const header = [
      "class",
      "subj n(pre/post)",
      "subj H pre",
      "subj H post",
      "ΔH%",
      "ctrl H post (n)",
      "verdict",
    ];
    console.log(`\n${header.join(" | ")}`);
    console.log(header.map(() => "---").join(" | "));

    let anyLitUp = false;
    const classes = [...subjBefore.keys()].filter((k) => subjAfter.has(k));
    for (const cls of classes) {
      const pre = subjBefore.get(cls)!;
      const post = subjAfter.get(cls)!;
      const ctrlPost = ctrlAfter.get(cls) ?? null;
      if (pre.n < 3 || post.n < 3) continue;

      const dropPct =
        pre.entropyBits > 0
          ? ((pre.entropyBits - post.entropyBits) / pre.entropyBits) * 100
          : 0;
      const quantDrop = dropPct >= 30;
      const qualSwitch = spread(pre) && concentrated(post);
      const beatsControl =
        ctrlPost !== null &&
        ctrlPost.n >= 3 &&
        post.entropyBits < ctrlPost.entropyBits;

      const lit = (quantDrop || qualSwitch) && beatsControl;
      if (lit) anyLitUp = true;

      console.log(
        [
          cls,
          `${pre.n}/${post.n}`,
          pre.entropyBits.toFixed(3),
          post.entropyBits.toFixed(3),
          `${dropPct.toFixed(0)}%${qualSwitch ? " +qual" : ""}`,
          ctrlPost !== null ? `${ctrlPost.entropyBits.toFixed(3)} (${ctrlPost.n})` : "—",
          lit ? "LIT" : quantDrop || qualSwitch ? "drop, ctrl not beaten" : "no",
        ].join(" | "),
      );
    }

    console.log(
      anyLitUp
        ? "\n# STEP F ACCEPTANCE: LIT — at least one stimulus class meets the criterion."
        : "\n# Step F acceptance not met on this run.",
    );
    process.exitCode = anyLitUp ? 0 : 2;
  } finally {
    await close();
  }
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
