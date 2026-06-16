#!/usr/bin/env python3
"""Step D acceptance — skill match→use analysis over a lab capture log.

  python3 analyze-skill-matches.py <peppers-cascades.jsonl> [--ghost <displayName>]

For every cascade with a non-null skillMatch, report the stimulus class,
matched trigger, similarity, and the action actually taken; then the
aggregate: in matched cascades, how often did the action agree with the
skill's recommended verb(s) vs in unmatched cascades on the SAME
stimulus classes (the Step D acceptance comparison).

Skill recommendation verbs are read from Neo4j-free context: we infer
them from the matched skill's trigger class by looking at what the
post-sleep distribution concentrates on — this script only reports;
judgement stays with the measurement scripts.
"""
import json
import sys
from collections import defaultdict


def action_verb(action):
    if not isinstance(action, dict):
        return "(no-action)"
    kind = action.get("kind")
    return kind if isinstance(kind, str) and kind else "(no-action)"


def main():
    path = sys.argv[1]
    ghost_filter = None
    if "--ghost" in sys.argv:
        ghost_filter = sys.argv[sys.argv.index("--ghost") + 1]

    matched = []
    unmatched_by_class = defaultdict(lambda: defaultdict(int))
    matched_by_class = defaultdict(lambda: defaultdict(int))

    for line in open(path):
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("kind") != "cascade":
            continue
        if ghost_filter and r.get("displayName") != ghost_filter:
            continue
        stim = r.get("stimulus") or {}
        cls = stim.get("itemRef") or stim.get("kind") or "?"
        verb = action_verb(r.get("action"))
        sm = r.get("skillMatch")
        if sm:
            matched.append(
                {
                    "cascade": r.get("cascadeIndex"),
                    "ghost": r.get("displayName"),
                    "class": cls,
                    "trigger": sm.get("triggerSummary"),
                    "sim": sm.get("similarity"),
                    "action": verb,
                }
            )
            matched_by_class[cls][verb] += 1
        else:
            unmatched_by_class[cls][verb] += 1

    print(f"# matched cascades: {len(matched)}")
    for m in matched:
        print(
            f"  c{m['cascade']:>3} {m['ghost']}: [{m['class']}] sim={m['sim']:.3f} "
            f"trigger={m['trigger']!r} → action={m['action']}"
        )
    print("\n# action distribution in MATCHED cascades, per stimulus class:")
    for cls, dist in sorted(matched_by_class.items()):
        total = sum(dist.values())
        parts = ", ".join(f"{a}×{n}" for a, n in sorted(dist.items(), key=lambda x: -x[1]))
        print(f"  {cls} (n={total}): {parts}")
    print("\n# action distribution in UNMATCHED cascades, per stimulus class:")
    for cls, dist in sorted(unmatched_by_class.items()):
        total = sum(dist.values())
        parts = ", ".join(f"{a}×{n}" for a, n in sorted(dist.items(), key=lambda x: -x[1]))
        print(f"  {cls} (n={total}): {parts}")


if __name__ == "__main__":
    main()
