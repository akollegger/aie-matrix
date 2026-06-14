import { useState } from "react";
import { useLeaderboard } from "../../hooks/useLeaderboard.js";
import { LeaderboardEntry } from "./LeaderboardEntry.js";

interface SingleLeaderboardProps {
  readonly leaderboardId: string;
  readonly humanGhostId?: string | null;
}

function SingleLeaderboard({ leaderboardId, humanGhostId }: SingleLeaderboardProps) {
  const { result, loading, sessionComplete } = useLeaderboard(leaderboardId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {sessionComplete && (
        <div
          className="content-panel-dim"
          style={{
            display: "inline-block",
            marginBottom: 4,
            padding: "2px 8px",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--color-online)",
          }}
        >
          Session Complete
        </div>
      )}
      {loading && !result && (
        <p style={{ color: "var(--color-text-faint)", fontSize: 12, margin: 0 }}>
          Loading…
        </p>
      )}
      {result?.description && (
        <p style={{ color: "var(--color-text-muted)", fontSize: 11, margin: "0 0 8px" }}>
          {result.description}
        </p>
      )}
      {result && result.entries.length === 0 && !loading && (
        <p style={{ color: "var(--color-text-faint)", fontSize: 12, margin: 0 }}>
          No entries yet.
        </p>
      )}
      {result?.entries.map((entry, i) => (
        <LeaderboardEntry
          key={entry.actorId}
          rank={i + 1}
          entry={entry}
          isMe={!!humanGhostId && entry.actorId === humanGhostId}
        />
      ))}
    </div>
  );
}

export interface LeaderboardPanelProps {
  readonly leaderboardIds: string[];
  readonly humanGhostId?: string | null;
}

export function LeaderboardPanel({ leaderboardIds, humanGhostId }: LeaderboardPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (leaderboardIds.length === 0) {
    return (
      <div
        data-panel="leaderboard"
        className="overlay-structure"
        style={{ width: "100%", height: "100%", padding: "16px 18px 20px", overflowY: "auto" }}
      >
        <header
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-text-muted)",
            marginBottom: 12,
          }}
        >
          Leaderboards
        </header>
        <p style={{ color: "var(--color-text-faint)", fontSize: 12, margin: 0 }}>
          No leaderboards declared.
        </p>
      </div>
    );
  }

  const safeIndex = Math.min(activeIndex, leaderboardIds.length - 1);
  const activeId = leaderboardIds[safeIndex]!;

  return (
    <div
      data-panel="leaderboard"
      className="overlay-structure"
      style={{ width: "100%", height: "100%", padding: "16px 18px 20px", overflowY: "auto", boxSizing: "border-box" }}
    >
      <header
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--color-text-muted)",
          marginBottom: 10,
        }}
      >
        Leaderboards
      </header>

      {leaderboardIds.length > 1 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
          {leaderboardIds.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => { setActiveIndex(i); }}
              className={i === safeIndex ? "content-panel" : "content-panel-dim"}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                color: i === safeIndex ? "var(--color-text)" : "var(--color-text-muted)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      <div className="content-panel" style={{ padding: "8px 12px" }}>
        <SingleLeaderboard leaderboardId={activeId} humanGhostId={humanGhostId} />
      </div>
    </div>
  );
}
