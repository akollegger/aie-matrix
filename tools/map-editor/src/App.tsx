import { MapView } from "./map/MapView"
import { ItemTypePalette } from "./panels/ItemTypePalette"
import { LayerPanel } from "./panels/LayerPanel"
import { PolygonParamsPanel } from "./panels/PolygonParamsPanel"
import { PropertyEditor } from "./panels/PropertyEditor"
import { TileTypePalette } from "./panels/TileTypePalette"
import { ToolPanel } from "./panels/ToolPanel"

export function App() {
  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Left: map canvas */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <MapView />
      </div>

      {/* Right: sidebar */}
      <div
        style={{
          width: 280,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid #2a2a3e",
          background: "#16162a",
          overflow: "hidden",
        }}
      >
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
  )
}
