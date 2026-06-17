/**
 * Elbow detection on a sorted-descending score series (Kneedle-style,
 * max-distance-to-chord variant: normalise both axes, find the point
 * furthest from the straight line joining the first and last points).
 *
 * Returns the elbow INDEX, or null when the series is degenerate:
 * fewer than 3 points, or effectively flat (max-min spread below
 * `flatEpsilon` relative to the max). Callers must handle null —
 * for contradiction graphs made purely of symmetric pairs every node
 * has the same PageRank and there is no elbow to find.
 */
export function elbowIndex(
  sortedDesc: ReadonlyArray<number>,
  flatEpsilon = 1e-6,
): number | null {
  const n = sortedDesc.length;
  if (n < 3) return null;
  const first = sortedDesc[0]!;
  const last = sortedDesc[n - 1]!;
  const spread = first - last;
  if (!(spread > Math.abs(first) * flatEpsilon)) return null;

  let bestIdx: number | null = null;
  let bestDist = 0;
  for (let i = 1; i < n - 1; i++) {
    const x = i / (n - 1);
    const y = (sortedDesc[i]! - last) / spread; // 1 at i=0 → 0 at i=n-1
    const chordY = 1 - x; // straight line from (0,1) to (1,0)
    const dist = Math.abs(y - chordY);
    if (dist > bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Plain power-iteration PageRank over an undirected graph given as an
 * adjacency list (node index → neighbour indices). Damping 0.85,
 * convergence on L1 < 1e-9 or 100 iterations. Isolated nodes settle
 * at the teleport baseline.
 */
export function pageRankUndirected(
  adjacency: ReadonlyArray<ReadonlyArray<number>>,
  damping = 0.85,
): number[] {
  const n = adjacency.length;
  if (n === 0) return [];
  let rank = new Array<number>(n).fill(1 / n);
  for (let iter = 0; iter < 100; iter++) {
    const next = new Array<number>(n).fill((1 - damping) / n);
    let danglingMass = 0;
    for (let i = 0; i < n; i++) {
      const deg = adjacency[i]!.length;
      if (deg === 0) {
        danglingMass += rank[i]!;
        continue;
      }
      const share = (damping * rank[i]!) / deg;
      for (const j of adjacency[i]!) next[j]! += share;
    }
    const danglingShare = (damping * danglingMass) / n;
    for (let i = 0; i < n; i++) next[i]! += danglingShare;
    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i]! - rank[i]!);
    rank = next;
    if (delta < 1e-9) break;
  }
  return rank;
}
