import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { AgentHostError, listGhostSessions, shutdownGhostSession, type GhostSessionRecord } from "../../services/agentHostClient"

const panelStyle: CSSProperties = {
  width: 280,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  borderRight: "1px solid #2a2a3e",
  background: "#16162a",
  overflow: "hidden",
}

const headerStyle: CSSProperties = {
  background: "#11111f",
  borderBottom: "1px solid #2a2a3e",
  padding: "6px 8px",
  display: "flex",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
}

const actionBtn: CSSProperties = {
  background: "#1c1c30",
  color: "#aaa",
  border: "1px solid #2a2a3e",
  borderRadius: 3,
  padding: "2px 6px",
  fontSize: 10,
  cursor: "pointer",
  whiteSpace: "nowrap",
}
const ghostBtn: CSSProperties = { ...actionBtn, background: "none", border: "1px solid transparent" }
const dangerBtn: CSSProperties = { ...actionBtn, background: "#661122", color: "#f88", border: "1px solid #992233" }

const statusColors: Record<string, CSSProperties> = {
  running:    { color: "#66bb66" },
  spawning:   { color: "#cc8833" },
  unhealthy:  { color: "#ee6644" },
  restarting: { color: "#cc8833" },
  failed:     { color: "#ee4444" },
  shutdown:   { color: "#555" },
}

/** How often to poll for the pending spawn session to appear/become running (ms). */
const POLL_INTERVAL_MS = 1500
/** Give up waiting for "running" status after this many ms. */
const POLL_TIMEOUT_MS = 30_000

export interface GhostListPanelProps {
  agentId: string
  selectedGhostSessionId: string | null
  onSelectGhostSession: (id: string | null) => void
  onClose: () => void
  /**
   * Set immediately after a successful spawn so this panel can show a placeholder
   * row before the real session appears in the server list.
   */
  pendingSpawn?: { sessionId: string; ghostId: string } | null
  /** Called when the pending session reaches "running" status or the poll times out. */
  onPendingSpawnResolved?: () => void
}

export function GhostListPanel({
  agentId,
  selectedGhostSessionId,
  onSelectGhostSession,
  onClose,
  pendingSpawn,
  onPendingSpawnResolved,
}: GhostListPanelProps) {
  // FR-012: GhostSessionRecord type guarantees mcpToken is stripped at the service layer.
  // This component MUST NOT reference mcpToken in any variable, JSX, or rendered output.
  const [sessions, setSessions] = useState<GhostSessionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shutdownState, setShutdownState] = useState<Record<string, "idle" | "shutting" | "error">>({})
  const [shutdownError, setShutdownError] = useState<Record<string, string>>({})

  // Keep a stable ref to the resolved callback to avoid stale-closure issues in the
  // polling interval while still responding to prop changes.
  const onResolvedRef = useRef(onPendingSpawnResolved)
  useEffect(() => { onResolvedRef.current = onPendingSpawnResolved })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await listGhostSessions()
      // Filter to sessions for this agent
      setSessions(all.filter(s => s.agentId === agentId))
    } catch (e) {
      setError(e instanceof AgentHostError ? e.message : "Agent host is not reachable — check VITE_AGENT_HOST_URL")
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { void load() }, [load])

  // Esc closes this panel (goes up one level)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  // Poll for the pending spawn session until it reaches "running" or we time out.
  // The synthetic placeholder row is shown until the real session appears in `sessions`.
  useEffect(() => {
    if (!pendingSpawn) return

    const start = Date.now()
    const pendingSessionId = pendingSpawn.sessionId

    const tick = async () => {
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        clearInterval(handle)
        onResolvedRef.current?.()
        return
      }
      try {
        const all = await listGhostSessions()
        const found = all.find(s => s.sessionId === pendingSessionId)
        if (found) {
          // Merge into sessions state (replaces any existing entry with updated status)
          setSessions(prev => {
            const without = prev.filter(s => s.sessionId !== found.sessionId)
            return [found, ...without]
          })
          if (found.status === "running") {
            clearInterval(handle)
            onResolvedRef.current?.()
          }
        }
      } catch {
        // ignore transient poll errors
      }
    }

    // eslint-disable-next-line prefer-const
    let handle = setInterval(tick, POLL_INTERVAL_MS)
    return () => clearInterval(handle)
    // pendingSpawn?.sessionId is the meaningful dep: re-runs when a new spawn is issued
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSpawn?.sessionId])

  async function handleShutdown(sessionId: string) {
    setShutdownState(s => ({ ...s, [sessionId]: "shutting" }))
    try {
      await shutdownGhostSession(sessionId)
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
      if (selectedGhostSessionId === sessionId) onSelectGhostSession(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Shutdown failed"
      setShutdownState(s => ({ ...s, [sessionId]: "error" }))
      setShutdownError(err => ({ ...err, [sessionId]: msg }))
    }
  }

  const agentLabel = agentId.length > 22 ? `${agentId.slice(0, 18)}…` : agentId

  // Show the synthetic placeholder only while pendingSpawn is set AND the real session
  // hasn't appeared in the list yet.
  const showPendingRow = !!(
    pendingSpawn &&
    !sessions.some(s => s.sessionId === pendingSpawn.sessionId)
  )

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#ccc", flex: 1 }}>
          Ghosts <span style={{ color: "#555", fontWeight: 400 }}>· {agentLabel}</span>
        </span>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{ ...ghostBtn, fontSize: 13, color: loading ? "#333" : "#555", padding: "0 3px" }}
          title="Reload ghost sessions"
        >↻</button>
        <button onClick={onClose} style={{ ...ghostBtn, fontSize: 13, color: "#555" }} title="Close (Esc)">✕</button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          padding: "6px 8px", background: "#2a0a0a", borderBottom: "1px solid #441111",
          fontSize: 10, color: "#f88", flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* Session list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && sessions.length === 0 && !pendingSpawn && (
          <div style={{ padding: "12px 8px", fontSize: 11, color: "#444" }}>Loading ghost sessions…</div>
        )}
        {!loading && !error && sessions.length === 0 && !pendingSpawn && (
          <div style={{ padding: "12px 8px", fontSize: 11, color: "#444" }}>No active ghost sessions</div>
        )}

        {/* Synthetic "pending" row — shown immediately after spawn, before the server
            confirms the session exists. Disappears once the real session appears. */}
        {showPendingRow && (
          <div
            style={{
              padding: "6px 8px", borderBottom: "1px solid #1a1a2e",
              background: "#12122a",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
              <span style={{
                flex: 1, fontSize: 11, color: "#99bbff", fontFamily: "monospace",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {pendingSpawn!.sessionId.length > 15
                  ? `${pendingSpawn!.sessionId.slice(0, 14)}…`
                  : pendingSpawn!.sessionId}
              </span>
              {/* Animated dot — pure CSS keyframe would need a <style> tag; use a
                  simple blinking character via inline animation polyfill instead. */}
              <span style={{ ...statusColors["spawning"], fontSize: 9 }}>
                spawning…
              </span>
            </div>
            <div style={{ fontSize: 9, color: "#445" }}>
              ghost: {pendingSpawn!.ghostId.length > 20
                ? `${pendingSpawn!.ghostId.slice(0, 20)}…`
                : pendingSpawn!.ghostId}
            </div>
          </div>
        )}

        {sessions.map(session => {
          const isSelected = selectedGhostSessionId === session.sessionId
          const statusStyle = statusColors[session.status] ?? { color: "#888" }
          const shutdown = shutdownState[session.sessionId] ?? "idle"

          return (
            <div key={session.sessionId}>
              <div
                onClick={() => onSelectGhostSession(isSelected ? null : session.sessionId)}
                style={{
                  padding: "6px 8px", borderBottom: "1px solid #1a1a2e",
                  background: isSelected ? "#1a2244" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                  <span style={{ flex: 1, fontSize: 11, color: "#99bbff", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {session.sessionId.slice(0, 14)}…
                  </span>
                  <span style={{ ...statusStyle, fontSize: 9 }}>{session.status}</span>
                  <button
                    onClick={e => { e.stopPropagation(); void handleShutdown(session.sessionId) }}
                    disabled={shutdown === "shutting"}
                    style={dangerBtn}
                  >
                    {shutdown === "shutting" ? "…" : "Shutdown"}
                  </button>
                </div>
                <div style={{ fontSize: 9, color: "#445" }}>
                  ghost: {session.ghostId.slice(0, 20)}{session.ghostId.length > 20 ? "…" : ""}
                </div>
                {shutdown === "error" && shutdownError[session.sessionId] && (
                  <div style={{ fontSize: 9, color: "#f88", marginTop: 2 }}>
                    {shutdownError[session.sessionId]}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
