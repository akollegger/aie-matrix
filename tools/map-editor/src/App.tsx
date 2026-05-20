import { useState } from "react"
import type { CSSProperties } from "react"
import { MapView } from "./map/MapView"
import { AdminPanel } from "./panels/AdminPanel"
import { ItemTypePalette } from "./panels/ItemTypePalette"
import { LayerPanel } from "./panels/LayerPanel"
import { PolygonParamsPanel } from "./panels/PolygonParamsPanel"
import { PropertyEditor } from "./panels/PropertyEditor"
import { TileTypePalette } from "./panels/TileTypePalette"
import { ToolPanel } from "./panels/ToolPanel"

const modeBtn = (active: boolean): CSSProperties => ({
  background: active ? "#2255aa" : "#1c1c30",
  color: active ? "#ddf" : "#666",
  border: `1px solid ${active ? "#3366cc" : "#2a2a3e"}`,
  borderRadius: 4,
  padding: "2px 12px",
  fontSize: 11,
  cursor: "pointer",
})

export function App() {
  const [mode, setMode] = useState<"edit" | "admin">("edit")

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Mode toggle bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        background: "#0e0e1c",
        borderBottom: "1px solid #2a2a3e",
        flexShrink: 0,
      }}>
        <button onClick={() => setMode("edit")} style={modeBtn(mode === "edit")}>Edit</button>
        <button onClick={() => setMode("admin")} style={modeBtn(mode === "admin")}>Admin</button>
      </div>

      {/* Content — map is always full-size, panels float as overlays */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Map canvas — always full size */}
        <div style={{ position: "absolute", inset: 0 }}>
          <MapView />
        </div>

        {/* Admin panel — left overlay */}
        <div style={{
          position: "absolute", top: 0, left: 0, bottom: 0,
          display: mode === "admin" ? "flex" : "none",
          zIndex: 10,
          boxShadow: "4px 0 16px rgba(0,0,0,0.6)",
        }}>
          <AdminPanel />
        </div>

        {/* Edit sidebar — right overlay */}
        <div style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 280,
          display: mode === "edit" ? "flex" : "none",
          flexDirection: "column",
          borderLeft: "1px solid #2a2a3e",
          background: "#16162a",
          overflow: "hidden",
          zIndex: 10,
          boxShadow: "-4px 0 16px rgba(0,0,0,0.6)",
        }}>
          <ToolPanel />
          <div style={{ overflowY: "auto", flexShrink: 0, maxHeight: "60%" }}>
            <LayerPanel />
            <TileTypePalette />
            <PolygonParamsPanel />
            <ItemTypePalette />
          </div>
          <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid #2a2a3e" }}>
            <PropertyEditor />
          </div>
        </div>
      </div>
    </div>
  )
}
