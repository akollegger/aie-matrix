import { useEffect, useState } from "react"
import type { CSSProperties } from "react"
import type { AdminSelection } from "../../hooks/useAdminSelection.js"
import { AgentHostError, getAgentCard } from "../../services/agentHostClient.js"
import { getGhostPosition } from "../../services/registryClient.js"
import { useEditor } from "../../state/editor-context.js"
import { LeaderboardDefinitionCard } from "./LeaderboardDefinitionCard.js"

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    })
  } catch {
    return iso
  }
}

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

/** Poll interval for ghost position updates (ms). */
const GHOST_POS_POLL_MS = 2000

export interface DetailPanelProps {
  selection: AdminSelection
}

/**
 * Right-side detail overlay for the admin panel.
 * Shows contextual detail for the currently selected admin item.
 * FR-012: mcpToken MUST NOT appear in any rendered output in this component.
 */
export function DetailPanel({ selection }: DetailPanelProps) {
  const { selectedMap, selectedSessionId, selectedAgentId, selectedGhostSessionId, selectedGhostId } = selection
  const hasSelection = !!(selectedMap || selectedSessionId || selectedAgentId || selectedGhostSessionId)
  const { state, dispatch } = useEditor()

  // Fetched A2A agent card — loaded whenever selectedAgentId changes.
  const [agentCardData, setAgentCardData] = useState<unknown>(null)
  const [agentCardLoading, setAgentCardLoading] = useState(false)
  const [agentCardError, setAgentCardError] = useState<string | null>(null)

  // Ghost position — polled while a ghost session is selected.
  const [ghostPos, setGhostPos] = useState<{ h3Index: string; status: string } | null>(null)

  useEffect(() => {
    if (!selectedAgentId) {
      setAgentCardData(null)
      setAgentCardError(null)
      return
    }
    let cancelled = false
    setAgentCardLoading(true)
    setAgentCardError(null)
    getAgentCard(selectedAgentId)
      .then(card => {
        if (!cancelled) { setAgentCardData(card); setAgentCardLoading(false) }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAgentCardError(
            e instanceof AgentHostError ? e.message : "Failed to load agent card",
          )
          setAgentCardLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [selectedAgentId])

  // Poll ghost position while a ghost is selected.
  useEffect(() => {
    if (!selectedGhostId) { setGhostPos(null); return }
    let active = true
    const poll = async () => {
      try {
        const pos = await getGhostPosition(selectedGhostId)
        if (active) setGhostPos(pos)
      } catch { /* ignore transient errors */ }
    }
    void poll()
    const handle = setInterval(() => { void poll() }, GHOST_POS_POLL_MS)
    return () => { active = false; clearInterval(handle) }
  }, [selectedGhostId])

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
        {!hasSelection && (
          <div style={{ padding: "16px 8px", fontSize: 11, color: "#444", lineHeight: 1.6 }}>
            Select a map or session to inspect details.
          </div>
        )}

        {/* Map detail — shown when a map is selected and nothing deeper */}
        {selectedMap && !selectedSessionId && !selectedAgentId && !selectedGhostSessionId && (
          <>
            <div style={sectionLabel}>Map</div>

            <div style={valueRow}>
              <span style={labelStyle}>Name</span>
              <span style={{ ...valueStyle, fontFamily: "inherit", fontSize: 13, color: "#ddf" }}>
                {selectedMap.name || selectedMap.mapId}
              </span>
            </div>

            <div style={valueRow}>
              <span style={labelStyle}>Map ID</span>
              <span style={valueStyle}>{selectedMap.mapId}</span>
            </div>

            <div style={valueRow}>
              <span style={labelStyle}>Status</span>
              <span style={{
                display: "inline-block",
                fontSize: 9,
                padding: "1px 6px",
                borderRadius: 3,
                background: selectedMap.status === "published" ? "#1a3a1a" : "#2a1a00",
                color: selectedMap.status === "published" ? "#66cc66" : "#cc8833",
                border: `1px solid ${selectedMap.status === "published" ? "#224422" : "#443300"}`,
                marginTop: 2,
              }}>
                {selectedMap.status}
              </span>
            </div>

            <div style={valueRow}>
              <span style={labelStyle}>Published</span>
              <span style={valueStyle}>{formatDate(selectedMap.publishedAt)}</span>
            </div>

            {selectedMap.archivedAt && (
              <div style={valueRow}>
                <span style={labelStyle}>Archived</span>
                <span style={valueStyle}>{formatDate(selectedMap.archivedAt)}</span>
              </div>
            )}

            {selectedMap.gcsPath && (
              <div style={valueRow}>
                <span style={labelStyle}>Storage</span>
                <span style={{ ...valueStyle, fontSize: 9, color: "#556" }}>{selectedMap.gcsPath}</span>
              </div>
            )}

            {selectedMap.contentHash && (
              <div style={valueRow}>
                <span style={labelStyle}>Content Hash</span>
                <span style={{ ...valueStyle, fontSize: 9, color: "#445" }}>
                  {selectedMap.contentHash.slice(0, 12)}…
                </span>
              </div>
            )}

            {state.leaderboards.length > 0 && (
              <>
                <div style={sectionLabel}>Leaderboards</div>
                {state.leaderboards.map(spec => (
                  <LeaderboardDefinitionCard key={spec.id} spec={spec} />
                ))}
              </>
            )}

            <div style={{ padding: "8px 8px", fontSize: 10, color: "#445" }}>
              Expand the map row to manage sessions.
            </div>
          </>
        )}

        {selectedGhostSessionId && (
          <>
            <div style={sectionLabel}>Ghost Session</div>
            <div style={valueRow}>
              <span style={labelStyle}>Session ID</span>
              <span style={valueStyle}>{selectedGhostSessionId}</span>
            </div>
            {selectedGhostId && (
              <div style={valueRow}>
                <span style={labelStyle}>Ghost ID</span>
                <span style={valueStyle}>{selectedGhostId}</span>
              </div>
            )}
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

            {/* Live position — polled every 2 s */}
            <div style={sectionLabel}>Position</div>
            {ghostPos ? (
              <>
                <div style={valueRow}>
                  <span style={labelStyle}>H3 Cell</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ ...valueStyle, letterSpacing: "0.04em", flex: 1 }}>{ghostPos.h3Index}</span>
                    <button
                      onClick={() => dispatch({ type: "FIT_TO_CELL", h3Index: ghostPos.h3Index })}
                      title="Pan map to this cell"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 13,
                        padding: "0 2px",
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      🎯
                    </button>
                  </div>
                </div>
                <div style={valueRow}>
                  <span style={labelStyle}>Status</span>
                  <span style={{
                    ...valueStyle,
                    color: ghostPos.status === "active" ? "#66bb66" : "#cc8833",
                    fontSize: 10,
                  }}>
                    {ghostPos.status}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ padding: "4px 8px", fontSize: 10, color: "#444" }}>
                {selectedGhostId ? "Fetching position…" : "No ghost selected"}
              </div>
            )}
          </>
        )}

        {/* Agent detail — full A2A card as JSON */}
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

            {agentCardLoading && (
              <div style={{ padding: "8px", fontSize: 10, color: "#444" }}>
                Loading agent card…
              </div>
            )}

            {agentCardError && (
              <div style={{ padding: "6px 8px", fontSize: 10, color: "#f88" }}>
                {agentCardError}
              </div>
            )}

            {agentCardData != null && !agentCardLoading && (
              <>
                <div style={sectionLabel}>A2A Agent Card</div>
                <pre style={{
                  margin: 0,
                  padding: "6px 8px 12px",
                  fontSize: 9,
                  color: "#7788aa",
                  lineHeight: 1.55,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}>
                  {JSON.stringify(agentCardData, null, 2)}
                </pre>
              </>
            )}
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
