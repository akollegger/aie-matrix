import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import {
  AgentHostError,
  deregisterAgent,
  listAgents,
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
const dangerBtn: CSSProperties = { ...actionBtn, background: "#661122", color: "#f88", border: "1px solid #992233" }
const successBtn: CSSProperties = { ...actionBtn, background: "#225522", color: "#8f8", border: "1px solid #336633" }

const tierColors: Record<AgentCatalogEntry["tier"], CSSProperties> = {
  wanderer: { background: "#2a1a00", color: "#cc8833", border: "1px solid #443300", borderRadius: 3, fontSize: 9, padding: "1px 5px" },
  listener: { background: "#1a2a44", color: "#5599ee", border: "1px solid #2244aa", borderRadius: 3, fontSize: 9, padding: "1px 5px" },
  social:   { background: "#1a2a1a", color: "#66bb66", border: "1px solid #335533", borderRadius: 3, fontSize: 9, padding: "1px 5px" },
}

export interface CatalogPanelProps {
  sessionId: string
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
  onClose: () => void
}

export function CatalogPanel({ sessionId, selectedAgentId, onSelectAgent, onClose }: CatalogPanelProps) {
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null)

  // Per-row action state
  const [spawnState, setSpawnState] = useState<Record<string, "idle" | "spawning" | "success" | "error">>({})
  const [spawnResult, setSpawnResult] = useState<Record<string, string>>({})
  const [deregisterState, setDeregisterState] = useState<Record<string, "idle" | "pending" | "error">>({})
  const [deregisterError, setDeregisterError] = useState<Record<string, string>>({})

  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listAgents()
      setAgents(list)
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
    setSpawnResult(r => { const c = { ...r }; delete c[agentId]; return c })
    try {
      const { sessionId: spawnedSessionId } = await oneClickSpawn(agentId)
      setSpawnState(s => ({ ...s, [agentId]: "success" }))
      setSpawnResult(r => ({ ...r, [agentId]: spawnedSessionId }))
      onSelectAgent(agentId) // open the ghost list for this agent
    } catch (e) {
      setSpawnState(s => ({ ...s, [agentId]: "error" }))
      setSpawnResult(r => ({ ...r, [agentId]: e instanceof Error ? e.message : "Spawn failed" }))
    }
  }

  async function handleDeregister(agentId: string) {
    if (deregisterState[agentId] !== "pending") {
      setDeregisterState(s => ({ ...s, [agentId]: "pending" }))
      return
    }
    // Second click confirms
    setDeregisterState(s => ({ ...s, [agentId]: "idle" }))
    try {
      await deregisterAgent(agentId)
      void load()
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Deregister failed"
      // Attempt to extract count from server error body for FR-005 message
      if (e instanceof AgentHostError && e.status === 409) {
        // Server returns "ActiveSessionsPreventDeregister" — we need count
        // Try to fetch sessions to get count, or use generic message
        msg = e.message.includes("active") ? e.message : "Cannot deregister: agent has active sessions"
      }
      setDeregisterState(s => ({ ...s, [agentId]: "error" }))
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
          const isExpanded = expandedAgentId === agent.agentId
          const isSelected = selectedAgentId === agent.agentId
          const isHovered = hoveredAgentId === agent.agentId
          const spawn = spawnState[agent.agentId] ?? "idle"
          const deregister = deregisterState[agent.agentId] ?? "idle"

          return (
            <div key={agent.agentId}>
              {/* Agent row */}
              <div
                onMouseEnter={() => setHoveredAgentId(agent.agentId)}
                onMouseLeave={() => setHoveredAgentId(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "5px 8px", borderBottom: "1px solid #1a1a2e",
                  background: isSelected ? "#1a2244" : isHovered ? "#1a1a2e" : "transparent",
                  minHeight: 32, cursor: "pointer",
                }}
                onClick={() => {
                  setExpandedAgentId(isExpanded ? null : agent.agentId)
                  onSelectAgent(isSelected ? null : agent.agentId)
                }}
              >
                <button
                  onClick={e => { e.stopPropagation(); setExpandedAgentId(isExpanded ? null : agent.agentId) }}
                  style={{ ...ghostBtn, padding: "0 2px", fontSize: 9, color: "#444" }}
                >
                  {isExpanded ? "▼" : "▶"}
                </button>

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

                <span style={tierColors[agent.tier]}>{agent.tier}</span>
                {agent.builtIn && (
                  <span style={{ fontSize: 9, color: "#445", border: "1px solid #2a2a3e", borderRadius: 3, padding: "1px 4px" }}>
                    built-in
                  </span>
                )}
              </div>

              {/* Expanded: agent card JSON + actions */}
              {isExpanded && (
                <div style={{ background: "#12122a", borderBottom: "1px solid #1a1a2e" }}>
                  {/* Action buttons */}
                  <div style={{ padding: "6px 8px 4px", display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button
                      onClick={e => { e.stopPropagation(); void handleSpawn(agent.agentId) }}
                      disabled={spawn === "spawning"}
                      style={spawn === "success" ? successBtn : actionBtn}
                    >
                      {spawn === "spawning" ? "Spawning…" : spawn === "success" ? "Spawned ✓" : "Spawn Ghost"}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); void handleDeregister(agent.agentId) }}
                      style={deregister === "pending" ? dangerBtn : { ...actionBtn, color: "#888" }}
                    >
                      {deregister === "pending" ? "Sure?" : "Deregister"}
                    </button>
                  </div>

                  {/* Spawn result / error */}
                  {spawn === "success" && spawnResult[agent.agentId] && (
                    <div style={{ padding: "2px 8px 6px", fontSize: 10, color: "#8f8" }}>
                      sessionId: {spawnResult[agent.agentId]}
                    </div>
                  )}
                  {spawn === "error" && spawnResult[agent.agentId] && (
                    <div style={{ padding: "2px 8px 6px", fontSize: 10, color: "#f88" }}>
                      {spawnResult[agent.agentId]}
                    </div>
                  )}

                  {/* Deregister error (FR-005) */}
                  {deregister === "error" && deregisterError[agent.agentId] && (
                    <div style={{ padding: "2px 8px 6px", fontSize: 10, color: "#f88" }}>
                      {deregisterError[agent.agentId]}
                    </div>
                  )}

                  {/* Full agent card JSON */}
                  <pre style={{
                    margin: 0, padding: "4px 8px 8px",
                    fontSize: 9, color: "#666", overflowX: "auto",
                    maxHeight: 200, overflowY: "auto",
                  }}>
                    {JSON.stringify(agent.agentCard, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
