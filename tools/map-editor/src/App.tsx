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
import { CatalogPanel } from "./panels/admin/CatalogPanel"
import { GhostListPanel } from "./panels/admin/GhostListPanel"
import { DetailPanel } from "./panels/detail/DetailPanel"
import { useAdminSelection } from "./hooks/useAdminSelection"

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
  const { selection, selectSession, selectAgent, selectGhostSession } = useAdminSelection()

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

        {/* Admin left overlay — Miller columns: AdminPanel | CatalogPanel? | GhostListPanel? */}
        {mode === "admin" && (
          <div style={{
            position: "absolute", top: 0, left: 0, bottom: 0,
            display: "flex",
            zIndex: 10,
            boxShadow: "4px 0 16px rgba(0,0,0,0.6)",
          }}>
            <AdminPanel
              selectedSessionId={selection.selectedSessionId}
              onSelectSession={selectSession}
            />
            {selection.selectedSessionId && (
              <CatalogPanel
                sessionId={selection.selectedSessionId}
                selectedAgentId={selection.selectedAgentId}
                onSelectAgent={selectAgent}
                onClose={() => selectSession(null)}
              />
            )}
            {selection.selectedAgentId && (
              <GhostListPanel
                agentId={selection.selectedAgentId}
                selectedGhostSessionId={selection.selectedGhostSessionId}
                onSelectGhostSession={selectGhostSession}
                onClose={() => selectAgent(null)}
              />
            )}
          </div>
        )}

        {/* Admin right overlay — detail panel */}
        {mode === "admin" && (
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 280,
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid #2a2a3e",
            background: "#16162a",
            overflow: "hidden",
            zIndex: 10,
            boxShadow: "-4px 0 16px rgba(0,0,0,0.6)",
          }}>
            <DetailPanel selection={selection} />
          </div>
        )}

        {/* Edit sidebar — right overlay */}
        {mode === "edit" && (
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 280,
            display: "flex",
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
        )}
      </div>
    </div>
  )
}
