import type { WorldTile } from "../../types/worldTile.js";

export function TileTooltip({
  tile,
  x,
  y,
}: {
  readonly tile: WorldTile;
  readonly x: number;
  readonly y: number;
}) {
  return (
    <div
      className="tile-tooltip"
      style={{
        position: "fixed",
        left: x + 12,
        top: y + 12,
        pointerEvents: "none",
        background: "rgba(12, 14, 20, 0.92)",
        color: "#e6edf3",
        fontSize: 12,
        padding: "6px 10px",
        borderRadius: 6,
        border: "1px solid rgba(100, 160, 255, 0.35)",
        maxWidth: 280,
        zIndex: 50,
      }}
    >
      <div style={{ fontWeight: 600 }}>{tile.tileType}</div>
      <div style={{ opacity: 0.8, fontSize: 11, marginTop: 2 }}>{tile.h3Index}</div>
    </div>
  );
}
