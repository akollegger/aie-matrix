import type { GhostIdentity } from "../../types/ghost.js";
import type { GhostPosition } from "../../types/ghostPosition.js";

export interface ThreadSlot {
  readonly ghostId: string;
  readonly isPermanent: boolean;
}

interface ThreadPillsProps {
  readonly threads: readonly ThreadSlot[];
  readonly activeGhostId: string | null;
  readonly ghosts: ReadonlyMap<string, GhostPosition>;
  readonly identities: ReadonlyMap<string, GhostIdentity>;
  readonly onSelect: (ghostId: string) => void;
  readonly onClose: (ghostId: string) => void;
}

export function ThreadPills({ threads, activeGhostId, ghosts, identities, onSelect, onClose }: ThreadPillsProps) {
  if (threads.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px 0" }}>
      {threads.map(({ ghostId, isPermanent }) => {
        const isSelected = ghostId === activeGhostId;
        const isOnline = ghosts.has(ghostId);
        const name = identities.get(ghostId)?.name ?? ghostId.slice(0, 12);

        if (!isPermanent) {
          return (
            <div
              key={ghostId}
              onClick={() => onSelect(ghostId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 8px 3px 7px",
                cursor: "pointer",
                background: "rgba(55,138,221,0.06)",
                border: "1px dashed rgba(100,150,220,0.35)",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  flexShrink: 0,
                  border: "1px solid rgba(100,150,220,0.55)",
                  background: "transparent",
                }}
              />
              <span style={{ fontStyle: "italic", color: "var(--color-text-dim)" }}>{name}</span>
              <span style={{ fontSize: 10, color: "rgba(100,150,220,0.5)", marginLeft: 1, lineHeight: 1 }}>+</span>
            </div>
          );
        }

        return (
          <div
            key={ghostId}
            className={isSelected ? "content-panel" : "content-panel-dim"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px 3px 7px",
              cursor: "pointer",
              fontSize: 12,
              borderRadius: 4,
            }}
            onClick={() => onSelect(ghostId)}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                flexShrink: 0,
                background: isOnline ? "var(--color-online)" : "var(--color-offline)",
              }}
            />
            <span style={{ color: isSelected ? "var(--color-text)" : "var(--color-text-dim)" }}>
              {name}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(ghostId); }}
              style={{
                marginLeft: 2,
                background: "none",
                border: "none",
                color: "var(--color-text-faint)",
                cursor: "pointer",
                padding: "0 1px",
                fontSize: 13,
                lineHeight: 1,
              }}
              title="Close thread"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
