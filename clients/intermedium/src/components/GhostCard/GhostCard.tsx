import type { GhostPosition } from "../../types/ghostPosition.js";
import type { WorldTile } from "../../types/worldTile.js";

export interface GhostCardProps {
  readonly name: string;
  readonly className: string;
  readonly tile: WorldTile | null;
  readonly position: GhostPosition;
}

/**
 * Area / Neighbor list row: catalog name + class + current cell tile type.
 */
export function GhostCard({ name, className, tile, position }: GhostCardProps) {
  const tileLabel = tile?.tileType ?? position.h3Index;
  return (
    <article
      style={{
        border: "1px solid rgba(120, 160, 200, 0.35)",
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 8,
        background: "rgba(8, 14, 24, 0.75)",
        color: "rgba(230, 236, 245, 0.95)",
        fontSize: 13,
        lineHeight: 1.35,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
      <div style={{ color: "rgba(180, 200, 220, 0.9)", fontSize: 12 }}>{className}</div>
      <div style={{ color: "rgba(150, 175, 200, 0.85)", fontSize: 11, marginTop: 6 }}>{tileLabel}</div>
    </article>
  );
}
