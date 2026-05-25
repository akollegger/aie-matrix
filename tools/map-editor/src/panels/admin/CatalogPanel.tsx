import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import {
  AgentHostError,
  deregisterAgent,
  listAgents,
  listGhostSessions,
  type AgentCatalogEntry,
} from "../../services/agentHostClient"
import { oneClickSpawn } from "../../services/registryClient"

const panelStyle: CSSProperties = {
  width: 300,
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

/** Play button — Noto Emoji ▶ for "spawn ghost", matching AdminPanel's map row style. */
const playBtn: CSSProperties = {
  ...ghostBtn,
  fontSize: 14,
  padding: "0 2px",
  flexShrink: 0,
  fontFamily: "'Noto Emoji', sans-serif",
}

export interface CatalogPanelProps {
  sessionId: string
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onClose: () => void
  /** Called when a ghost spawn completes so the parent can show a pending row in GhostListPanel. */
  onSpawnSuccess?: (info: { sessionId: string; ghostId: string; agentId: string }) => void
}

export function CatalogPanel({ sessionId, selectedAgentId, onSelectAgent, onClose, onSpawnSuccess }: CatalogPanelProps) {
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null)

  /** Count of ghost sessions per agentId (all statuses). Drives the count badge. */
  const [ghostCounts, setGhostCounts] = useState<Record<string, number>>({})

  /** Per-row spawn state. Resets to "idle" on success so further spawns are allowed. */
  const [spawnState, setSpawnState] = useState<Record<string, "idle" | "spawning" | "error">>({})
  const [spawnError, setSpawnError] = useState<Record<string, string>>({})

  /** Confirm-deregister (one row at a time). Cleared when mouse leaves the row. */
  const [pendingDeregisterId, setPendingDeregisterId] = useState<string | null>(null)
  const [deregisterError, setDeregisterError] = useState<Record<string, string>>({})

  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Load agents and ghost sessions in parallel; ghost-session failure is non-fatal.
      const [agentsResult, sessionsResult] = await Promise.allSettled([
        listAgents(),
        listGhostSessions(),
      ])
      if (agentsResult.status === "rejected") throw agentsResult.reason as unknown
      setAgents(agentsResult.value)
      if (sessionsResult.status === "fulfilled") {
        const counts: Record<string, number> = {}
        for (const s of sessionsResult.value) {
          counts[s.agentId] = (counts[s.agentId] ?? 0) + 1
        }
        setGhostCounts(counts)
      }
    } catch (e) {
      setError(e instanceof AgentHostError ? e.message : "Agent host is not reachable — check VITE_AGENT_HOST_URL")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Esc closes this panel (goes up one level)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  async function handleSpawn(agentId: string) {
    setSpawnState(s => ({ ...s, [agentId]: "spawning" }))
    setSpawnError(r => { const c = { ...r }; delete c[agentId]; return c })
    try {
      const { sessionId, ghostId } = await oneClickSpawn(agentId)
      // Reset to idle so further spawns are possible immediately.
      setSpawnState(s => ({ ...s, [agentId]: "idle" }))
      onSpawnSuccess?.({ sessionId, ghostId, agentId })
      onSelectAgent(agentId) // open the ghost list for this agent
      void load()            // refresh ghost count badge
    } catch (e) {
      setSpawnState(s => ({ ...s, [agentId]: "error" }))
      setSpawnError(r => ({ ...r, [agentId]: e instanceof Error ? e.message : "Spawn failed" }))
      // Auto-clear error after 4 s so the row returns to idle.
      setTimeout(() => {
        setSpawnState(s => ({ ...s, [agentId]: "idle" }))
        setSpawnError(r => { const c = { ...r }; delete c[agentId]; return c })
      }, 4000)
    }
  }

  async function handleDeregister(agentId: string) {
    if (pendingDeregisterId !== agentId) {
      // First click: request confirmation.
      setPendingDeregisterId(agentId)
      return
    }
    // Second click: confirmed.
    setPendingDeregisterId(null)
    setDeregisterError(err => { const c = { ...err }; delete c[agentId]; return c })
    try {
      await deregisterAgent(agentId)
      void load()
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Deregister failed"
      if (e instanceof AgentHostError && e.status === 409) {
        msg = e.message.includes("active") ? e.message : "Cannot deregister: agent has active sessions"
      }
      setDeregisterError(err => ({ ...err, [agentId]: msg }))
    }
  }

  const sessionLabel = sessionId.length > 20 ? `${sessionId.slice(0, 12)}…` : sessionId

  return (
    <div ref={panelRef} style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#ccc", flex: 1 }}>
          Catalog <span style={{ color: "#555", fontWeight: 400 }}>· {sessionLabel}</span>
        </span>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{ ...ghostBtn, fontSize: 13, color: loading ? "#333" : "#555", padding: "0 3px" }}
          title="Reload catalog"
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

      {/* Agent list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && agents.length === 0 && (
          <div style={{ padding: "12px 8px", fontSize: 11, color: "#444" }}>Loading agents…</div>
        )}
        {!loading && !error && agents.length === 0 && (
          <div style={{ padding: "12px 8px", fontSize: 11, color: "#444" }}>No agents registered</div>
        )}

        {agents.map(agent => {
          const isSelected = selectedAgentId === agent.agentId
          const isHovered = hoveredAgentId === agent.agentId
          const isPendingDeregister = pendingDeregisterId === agent.agentId
          const spawn = spawnState[agent.agentId] ?? "idle"
          const ghostCount = ghostCounts[agent.agentId] ?? 0

          return (
            <div key={agent.agentId}>
              {/* Agent row */}
              <div
                onMouseEnter={() => setHoveredAgentId(agent.agentId)}
                onMouseLeave={() => {
                  setHoveredAgentId(null)
                  // Clear pending-deregister confirm when cursor leaves the row.
                  if (pendingDeregisterId === agent.agentId) setPendingDeregisterId(null)
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "5px 8px", borderBottom: "1px solid #1a1a2e",
                  background: isSelected ? "#1a2244" : isHovered ? "#1a1a2e" : "transparent",
                  minHeight: 32, cursor: "pointer",
                }}
                onClick={() => onSelectAgent(isSelected ? null : agent.agentId)}
              >
                {/* Agent name + about subtitle */}
                <span style={{ flex: 1, overflow: "hidden" }}>
                  <span style={{ fontSize: 11, color: "#ccc", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent.agentId}
                  </span>
                  {agent.about && (
                    <span style={{ fontSize: 9, color: "#555", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {agent.about}
                    </span>
                  )}
                </span>

                {/* Ghost count badge — mirrors map session count badge in AdminPanel */}
                {ghostCount > 0 && (
                  <span style={{
                    background: "#1a3366",
                    color: "#7799ff",
                    border: "1px solid #2244aa",
                    borderRadius: 8,
                    fontSize: 9,
                    padding: "0 5px",
                    lineHeight: "14px",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}>
                    {ghostCount}
                  </span>
                )}

                {agent.builtIn && (
                  <span style={{ fontSize: 9, color: "#445", border: "1px solid #2a2a3e", borderRadius: 3, padding: "1px 4px" }}>
                    built-in
                  </span>
                )}

                {/* Hover actions — always in DOM so row height stays fixed */}
                <div style={{ display: "flex", gap: 3, alignItems: "center", visibility: isHovered ? "visible" : "hidden" }}>
                  {/* Spawn ghost ▶ */}
                  <button
                    onClick={e => { e.stopPropagation(); if (spawn !== "spawning") void handleSpawn(agent.agentId) }}
                    disabled={spawn === "spawning"}
                    title={spawn === "spawning" ? "Spawning…" : "Spawn ghost"}
                    style={{ ...playBtn, color: spawn === "spawning" ? "#444" : "#ccc" }}
                  >
                    {spawn === "spawning" ? "⟳" : "▶"}
                  </button>

                  {/* Deregister — two-click confirm, cleared on mouse-leave */}
                  <button
                    onClick={e => { e.stopPropagation(); void handleDeregister(agent.agentId) }}
                    title={isPendingDeregister ? "Click again to confirm deregister" : "Deregister agent"}
                    style={isPendingDeregister
                      ? { ...actionBtn, background: "#661122", color: "#f88", border: "1px solid #992233", fontSize: 10 }
                      : { ...ghostBtn, color: "#554", fontSize: 14, fontFamily: "'Noto Emoji', sans-serif" }
                    }
                  >
                    {isPendingDeregister ? "sure?" : "❎"}
                  </button>
                </div>
              </div>

              {/* Inline error messages (auto-cleared after timeout) */}
              {spawn === "error" && spawnError[agent.agentId] && (
                <div style={{
                  padding: "2px 8px 4px",
                  background: "#1a0808",
                  borderBottom: "1px solid #1a1a2e",
                  fontSize: 9, color: "#f88",
                }}>
                  ↳ {spawnError[agent.agentId]}
                </div>
              )}
              {deregisterError[agent.agentId] && (
                <div style={{
                  padding: "2px 8px 4px",
                  background: "#1a0808",
                  borderBottom: "1px solid #1a1a2e",
                  fontSize: 9, color: "#f88",
                }}>
                  ↳ {deregisterError[agent.agentId]}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
