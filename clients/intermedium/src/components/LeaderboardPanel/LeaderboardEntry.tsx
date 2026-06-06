import type { LeaderboardEntry as LeaderboardEntryType } from "@aie-matrix/shared-types";

export interface LeaderboardEntryProps {
  readonly rank: number; // 1-indexed
  readonly entry: LeaderboardEntryType;
}

/** Single leaderboard row: rank · displayName · score */
export function LeaderboardEntry({ rank, entry }: LeaderboardEntryProps) {
  const rankColor =
    rank === 1 ? "#ffd700" : rank === 2 ? "#c0c0c0" : rank === 3 ? "#cd7f32" : "rgba(160, 180, 210, 0.7)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "5px 4px",
        borderBottom: "1px solid rgba(100, 140, 180, 0.1)",
        fontSize: 13,
        color: "rgba(200, 215, 235, 0.9)",
      }}
    >
      <span style={{ color: rankColor, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {rank}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={entry.displayName}
      >
        {entry.displayName}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(160, 210, 255, 0.9)" }}>
        {entry.score.toLocaleString()}
      </span>
    </div>
  );
}
