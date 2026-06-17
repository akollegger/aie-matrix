import type { LeaderboardEntry as LeaderboardEntryType } from "@aie-matrix/shared-types";

export interface LeaderboardEntryProps {
  readonly rank: number;
  readonly entry: LeaderboardEntryType;
  readonly isMe?: boolean;
}

const RANK_COLORS: Record<number, string> = { 1: "#ffd700", 2: "#c0c0c0", 3: "#cd7f32" };

export function LeaderboardEntry({ rank, entry, isMe = false }: LeaderboardEntryProps) {
  const rankColor = RANK_COLORS[rank] ?? "var(--color-text-muted)";

  return (
    <div
      className={isMe ? "content-panel-dim" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "5px 4px",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 13,
        color: isMe ? "var(--color-ghost)" : "var(--color-text-dim)",
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
          fontWeight: isMe ? 600 : undefined,
        }}
        title={isMe ? `${entry.displayName} (you)` : entry.displayName}
      >
        {entry.displayName}
        {isMe && (
          <span style={{ marginLeft: 4, fontSize: "0.75em", color: "var(--color-text-faint)" }}>you</span>
        )}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-dim)" }}>
        {entry.score.toLocaleString()}
      </span>
    </div>
  );
}
