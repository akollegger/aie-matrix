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

const toggleBtn = (active: boolean): CSSProperties => ({
  background: active ? "#2255aa" : "#1c1c30",
  color: active ? "#ddf" : "#666",
  border: `1px solid ${active ? "#3366cc" : "#2a2a3e"}`,
  borderRadius: 4,
  padding: "2px 10px",
  fontSize: 11,
  cursor: "pointer",
  userSelect: "none",
})

export function App() {
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const { selection, selectMap, selectSession, selectAgent, selectGhostSession } = useAdminSelection()

  const hasAdminSelection = !!(
    selection.selectedMap ||
    selection.selectedSessionId ||
    selection.selectedAgentId ||
    selection.selectedGhostSessionId
  )

  function toggleAdmin() {
    if (adminPanelOpen) {
      // Clear selection when closing so the right panel reverts to edit tools
      selectMap(null)
    }
    setAdminPanelOpen(o => !o)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Top bar — hamburger toggle only */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        background: "#0e0e1c",
        borderBottom: "1px solid #2a2a3e",
        flexShrink: 0,
      }}>
        <button onClick={toggleAdmin} style={toggleBtn(adminPanelOpen)} title={adminPanelOpen ? "Hide admin panel" : "Show admin panel"}>
          ☰ Admin
        </button>
      </div>

      {/* Content — map always full-size, panels float as overlays */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Map canvas — always full size */}
        <div style={{ position: "absolute", inset: 0 }}>
          <MapView />
        </div>

        {/* Left overlay — Miller columns: AdminPanel | CatalogPanel? | GhostListPanel? */}
        {adminPanelOpen && (
          <div style={{
            position: "absolute", top: 0, left: 0, bottom: 0,
            display: "flex",
            zIndex: 10,
            boxShadow: "4px 0 16px rgba(0,0,0,0.6)",
          }}>
            <AdminPanel
              selectedMapId={selection.selectedMap?.mapId ?? null}
              onSelectMap={selectMap}
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

        {/* Right sidebar — always visible; shows admin detail when something is
            selected in the admin panel, otherwise shows the map editing tools. */}
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
          {adminPanelOpen && hasAdminSelection ? (
            <DetailPanel selection={selection} />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
