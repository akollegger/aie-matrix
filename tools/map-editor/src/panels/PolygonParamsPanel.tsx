import { useEditor } from "../state/editor-context"

const SHAPES: { sides: number; label: string }[] = [
  { sides: 3, label: "Triangle" },
  { sides: 4, label: "Rect" },
  { sides: 6, label: "Hexagon" },
]

export function PolygonParamsPanel() {
  const { state, dispatch } = useEditor()

  const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
  if (!activeLayer || activeLayer.kind !== "polygon") return null

  const { polygonVertexCount, activeTypeId } = state.ui

  return (
    <div style={{ borderBottom: "1px solid #2a2a3e" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 8px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        color: "#888",
        textTransform: "uppercase",
        background: "#11111f",
      }}>
        Polygon
      </div>

      {/* Shape picker */}
      <div style={{ display: "flex", gap: 4, padding: "4px 8px 6px" }}>
        {SHAPES.map(s => (
          <button
            key={s.sides}
            onClick={() => dispatch({ type: "SET_POLYGON_VERTEX_COUNT", count: s.sides })}
            style={{
              flex: 1,
              background: polygonVertexCount === s.sides ? "#2255aa" : "#1c1c30",
              color: polygonVertexCount === s.sides ? "#ddf" : "#888",
              border: `1px solid ${polygonVertexCount === s.sides ? "#3366cc" : "#2a2a3e"}`,
              borderRadius: 4,
              padding: "3px 4px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Tile type selector */}
      <div style={{ padding: "4px 0 6px" }}>
        {state.tileTypes.map(tt => {
          const bg = tt.style?.match(/background:\s*([^;]+)/)?.[1]?.trim() ?? "#4488cc"
          const active = tt.id === activeTypeId
          return (
            <div
              key={tt.id}
              onClick={() => dispatch({ type: "SET_ACTIVE_TYPE", typeId: tt.id })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "3px 8px",
                fontSize: 12,
                color: active ? "#ddf" : "#ccc",
                background: active ? "#1a2244" : "none",
                borderLeft: `3px solid ${active ? "#4488cc" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              <span style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: bg,
                flexShrink: 0,
                border: "1px solid rgba(255,255,255,0.15)",
              }} />
              <span style={{ flex: 1 }}>{tt.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
