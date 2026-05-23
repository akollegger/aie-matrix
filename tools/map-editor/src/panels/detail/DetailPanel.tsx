import type { CSSProperties } from "react"
import type { AdminSelection } from "../../hooks/useAdminSelection"

const sectionLabel: CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: "#445",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  padding: "8px 8px 2px",
}

const valueRow: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "3px 8px",
  borderBottom: "1px solid #1a1a2e",
}

const labelStyle: CSSProperties = { fontSize: 9, color: "#445" }
const valueStyle: CSSProperties = { fontSize: 11, color: "#ccc", fontFamily: "monospace", wordBreak: "break-all" }

export interface DetailPanelProps {
  selection: AdminSelection
}

/**
 * Right-side detail overlay for the admin panel.
 * Shows contextual detail for the currently selected admin item.
 * FR-012: mcpToken MUST NOT appear in any rendered output in this component.
 */
export function DetailPanel({ selection }: DetailPanelProps) {
  const { selectedSessionId, selectedAgentId, selectedGhostSessionId } = selection

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        background: "#11111f",
        borderBottom: "1px solid #2a2a3e",
        padding: "6px 8px",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#ccc" }}>Detail</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!selectedSessionId && !selectedAgentId && !selectedGhostSessionId && (
          <div style={{ padding: "16px 8px", fontSize: 11, color: "#444", lineHeight: 1.6 }}>
            Select a session or agent to inspect details.
          </div>
        )}

        {selectedGhostSessionId && (
          <>
            <div style={sectionLabel}>Ghost Session</div>
            <div style={valueRow}>
              <span style={labelStyle}>Session ID</span>
              <span style={valueStyle}>{selectedGhostSessionId}</span>
            </div>
            {selectedAgentId && (
              <div style={valueRow}>
                <span style={labelStyle}>Agent ID</span>
                <span style={valueStyle}>{selectedAgentId}</span>
              </div>
            )}
            {selectedSessionId && (
              <div style={valueRow}>
                <span style={labelStyle}>World Session</span>
                <span style={valueStyle}>{selectedSessionId}</span>
              </div>
            )}
          </>
        )}

        {selectedAgentId && !selectedGhostSessionId && (
          <>
            <div style={sectionLabel}>Agent</div>
            <div style={valueRow}>
              <span style={labelStyle}>Agent ID</span>
              <span style={valueStyle}>{selectedAgentId}</span>
            </div>
            {selectedSessionId && (
              <div style={valueRow}>
                <span style={labelStyle}>World Session</span>
                <span style={valueStyle}>{selectedSessionId}</span>
              </div>
            )}
            <div style={{ padding: "8px 8px", fontSize: 10, color: "#445" }}>
              Click a ghost session row to see its detail, or use Spawn Ghost in the Catalog panel.
            </div>
          </>
        )}

        {selectedSessionId && !selectedAgentId && !selectedGhostSessionId && (
          <>
            <div style={sectionLabel}>World Session</div>
            <div style={valueRow}>
              <span style={labelStyle}>Session ID</span>
              <span style={valueStyle}>{selectedSessionId}</span>
            </div>
            <div style={{ padding: "8px 8px", fontSize: 10, color: "#445" }}>
              Select an agent from the Catalog panel to spawn or inspect ghost sessions.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
