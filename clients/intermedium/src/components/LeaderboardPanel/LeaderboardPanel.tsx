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
    <div>
      {sessionComplete && (
        <div
          style={{
            display: "inline-block",
            marginBottom: 8,
            padding: "2px 8px",
            background: "rgba(100, 200, 120, 0.15)",
            border: "1px solid rgba(100, 200, 120, 0.4)",
            borderRadius: 4,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "rgba(100, 220, 130, 0.9)",
          }}
        >
          Session Complete
        </div>
      )}
      {loading && !result && (
        <p style={{ color: "rgba(180, 200, 220, 0.5)", fontSize: 12, margin: 0 }}>
          Loading…
        </p>
      )}
      {result && result.description && (
        <p style={{ color: "rgba(160, 180, 210, 0.7)", fontSize: 11, margin: "0 0 8px" }}>
          {result.description}
        </p>
      )}
      {result && result.entries.length === 0 && !loading && (
        <p style={{ color: "rgba(180, 200, 220, 0.5)", fontSize: 12, margin: 0 }}>
          No entries yet.
        </p>
      )}
      {result && result.entries.map((entry, i) => (
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

/**
 * Panel showing one or more leaderboards, with tab navigation when multiple exist.
 */
export function LeaderboardPanel({ leaderboardIds, humanGhostId }: LeaderboardPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const panelStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    padding: "16px 18px 20px",
    overflowY: "auto",
  };

  if (leaderboardIds.length === 0) {
    return (
      <div data-panel="leaderboard" style={panelStyle}>
        <header style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(160, 180, 210, 0.85)", marginBottom: 12 }}>
          Leaderboards
        </header>
        <p style={{ color: "rgba(180, 200, 220, 0.5)", fontSize: 12, margin: 0 }}>
          No leaderboards declared.
        </p>
      </div>
    );
  }

  const safeIndex = Math.min(activeIndex, leaderboardIds.length - 1);
  const activeId = leaderboardIds[safeIndex]!;

  return (
    <div data-panel="leaderboard" style={panelStyle}>
      <header style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(160, 180, 210, 0.85)", marginBottom: 10 }}>
        Leaderboards
      </header>

      {/* Tab strip — only shown when multiple leaderboards */}
      {leaderboardIds.length > 1 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
          {leaderboardIds.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => { setActiveIndex(i); }}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                border: `1px solid ${i === safeIndex ? "rgba(100, 160, 240, 0.6)" : "rgba(100, 140, 180, 0.3)"}`,
                borderRadius: 3,
                background: i === safeIndex ? "rgba(40, 80, 160, 0.25)" : "transparent",
                color: i === safeIndex ? "rgba(160, 200, 255, 0.95)" : "rgba(140, 170, 210, 0.6)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      <SingleLeaderboard leaderboardId={activeId} humanGhostId={humanGhostId} />
    </div>
  );
}
