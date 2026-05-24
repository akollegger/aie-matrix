import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { exportGram } from "../io/export-gram"
import { importGram } from "../io/import-gram"
import {
  archiveMap,
  endSession,
  listMaps,
  listSessions,
  loadMapGram,
  publishMap,
  startSession,
  switchSessionMap,
} from "../services/mapServer"
import type { ServerMapRecord, ServerSessionRecord } from "../services/mapServer"
import { listGhostSessions, shutdownGhostSession } from "../services/agentHostClient"
import { useEditor } from "../state/editor-context"

function slugId(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
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
const primaryBtn: CSSProperties = { ...actionBtn, background: "#2255aa", color: "#ddf", border: "1px solid #3366cc" }
const dangerBtn: CSSProperties = { ...actionBtn, background: "#661122", color: "#f88", border: "1px solid #992233" }
const ghostBtn: CSSProperties = { ...actionBtn, background: "none", border: "1px solid transparent" }

/** Play button — Noto Emoji ▶ for "start session". */
const playBtn: CSSProperties = {
  ...ghostBtn,
  fontSize: 14,
  padding: "0 2px",
  flexShrink: 0,
  fontFamily: "'Noto Emoji', sans-serif",
}

export interface AdminPanelProps {
  selectedMapId?: string | null
  onSelectMap?: (map: ServerMapRecord | null) => void
  selectedSessionId?: string | null
  onSelectSession?: (id: string | null) => void
}

export function AdminPanel({ selectedMapId = null, onSelectMap, selectedSessionId = null, onSelectSession }: AdminPanelProps) {
  const { state, dispatch } = useEditor()

  const [maps, setMaps] = useState<ServerMapRecord[]>([])
  const [sessions, setSessions] = useState<ServerSessionRecord[]>([])
  const [filterStatus, setFilterStatus] = useState<"published" | "archived" | undefined>("published")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [expandedMapId, setExpandedMapId] = useState<string | null>(null)
  const [hoveredMapId, setHoveredMapId] = useState<string | null>(null)
  const [startFormMapId, setStartFormMapId] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState("")
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [startStep, setStartStep] = useState<string | null>(null)

  // The slugified name of whatever is currently open in the editor.
  const editorMapId = slugId(state.meta.name) || "untitled"

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [mapList, sessionList] = await Promise.all([
        listMaps(filterStatus),
        listSessions("active"),
      ])
      setMaps(mapList)
      setSessions(sessionList)
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Refresh failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setLoading(false)
    }
  }, [filterStatus, dispatch])

  useEffect(() => { void refresh() }, [refresh])

  const sessionsByMapId = useMemo(() => {
    const result = new Map<string, ServerSessionRecord[]>()
    for (const s of sessions) {
      const primary = s.maps.find(m => m.role === "primary") ?? s.maps[0]
      if (primary) {
        const arr = result.get(primary.mapId) ?? []
        arr.push(s)
        result.set(primary.mapId, arr)
      }
    }
    return result
  }, [sessions])

  const publishedMaps = useMemo(() => maps.filter(m => m.status === "published"), [maps])
  const activeSessions = useMemo(() => sessions.filter(s => s.status === "active"), [sessions])

  async function handleLoad(mapId: string) {
    setBusy(`load-${mapId}`)
    try {
      const gram = await loadMapGram(mapId)
      const { state: imported, warnings } = await importGram(gram)
      dispatch({ type: "IMPORT_MAP", state: imported })
      dispatch({ type: "SET_PUBLISHED_MAP_ID", mapId })
      dispatch({ type: "SET_HINT", hint: warnings.length > 0 ? `Loaded with warnings: ${warnings.slice(0, 2).join("; ")}` : `Opened "${mapId}"` })
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Load failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  async function handleSave(mapId: string) {
    setSaving(true)
    try {
      await publishMap(mapId, exportGram(state))
      dispatch({ type: "SET_HINT", hint: `Saved "${mapId}"` })
      dispatch({ type: "SET_PUBLISHED_MAP_ID", mapId })
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Save failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(mapId: string) {
    if (confirmArchiveId !== mapId) { setConfirmArchiveId(mapId); return }
    setConfirmArchiveId(null)
    setBusy(`archive-${mapId}`)
    try {
      await archiveMap(mapId)
      dispatch({ type: "SET_HINT", hint: `Archived "${mapId}"` })
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Archive failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  async function handleStartSession(mapId: string) {
    const name = sessionName.trim()
    if (!name) { dispatch({ type: "SET_HINT", hint: "Session name is required" }); return }
    setBusy(`start-${mapId}`)
    try {
      // Step 1: shut down all running ghost sessions so they exit cleanly
      // before the live session is replaced. Failure here is non-fatal —
      // the agent-host may be unreachable in some environments.
      setStartStep("Shutting down ghosts…")
      try {
        const ghostSessions = await listGhostSessions()
        const running = ghostSessions.filter(s => s.status !== "ended" && s.status !== "cancelled")
        await Promise.allSettled(running.map(s => shutdownGhostSession(s.sessionId)))
      } catch {
        // agent-host unreachable — proceed with session transition anyway
      }

      // Step 2: end any active live session (single-session constraint).
      if (activeSessions.length > 0) {
        setStartStep("Ending current session…")
        for (const s of activeSessions) {
          await endSession(s.id)
        }
      }

      // Step 3: start the new session.
      setStartStep("Starting session…")
      await startSession(name, mapId)
      dispatch({ type: "SET_HINT", hint: `Session "${name}" started` })
      setStartFormMapId(null)
      setSessionName("")
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Start session failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
      setStartStep(null)
    }
  }

  async function handleEndSession(sessionId: string) {
    setBusy(`end-${sessionId}`)
    try {
      await endSession(sessionId)
      dispatch({ type: "SET_HINT", hint: "Session ended" })
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `End session failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  async function handleSwitchMap(sessionId: string, mapId: string) {
    setBusy(`switch-${sessionId}`)
    setSwitchingSessionId(null)
    try {
      const { removedCells, addedCells } = await switchSessionMap(sessionId, mapId)
      dispatch({ type: "SET_HINT", hint: `Map switched (+${addedCells.length} -${removedCells.length} cells)` })
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Switch failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{
      width: 280,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      borderRight: "1px solid #2a2a3e",
      background: "#16162a",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        background: "#11111f",
        borderBottom: "1px solid #2a2a3e",
        padding: "6px 8px",
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#ccc", flex: 1 }}>Maps</span>
        {([["published", "pub"], ["archived", "arch"], [undefined, "all"]] as const).map(([s, label]) => (
          <button
            key={label}
            onClick={() => setFilterStatus(s)}
            style={{ ...(filterStatus === s ? primaryBtn : actionBtn), fontSize: 9, padding: "1px 5px" }}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => void refresh()}
          disabled={loading}
          style={{ ...ghostBtn, fontSize: 13, color: loading ? "#333" : "#555", padding: "0 3px" }}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Map list — alphabetical, all server maps */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {maps.map(map => {
          const mapSessions = sessionsByMapId.get(map.mapId) ?? []
          const sessionCount = mapSessions.length
          const isExpanded = expandedMapId === map.mapId
          const isHovered = hoveredMapId === map.mapId
          const isArchived = map.status === "archived"
          const isSelected = selectedMapId === map.mapId
          /** Currently open in the editor — highlighted like an IDE active file. */
          const isOpen = map.mapId === editorMapId
          /** Unsaved changes exist for the open buffer. */
          const isDirty = isOpen && state.ui.dirty
          const label = map.name || map.mapId

          return (
            <div key={map.mapId}>
              {/* Map row */}
              <div
                onMouseEnter={() => setHoveredMapId(map.mapId)}
                onMouseLeave={() => { setHoveredMapId(null); setConfirmArchiveId(null) }}
                onDoubleClick={() => {
                  if (isOpen) { dispatch({ type: "FIT_BOUNDS" }); return }
                  if (state.ui.dirty) {
                    dispatch({ type: "SET_HINT", hint: "Save or cancel your changes before opening another map" })
                    return
                  }
                  if (!busy) void handleLoad(map.mapId)
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 8px",
                  // Open file gets a left-edge accent like VS Code's active file
                  borderLeft: isOpen ? "2px solid #3366cc" : "2px solid transparent",
                  borderBottom: "1px solid #1a1a2e",
                  background: isSelected ? "#1a2244" : isOpen ? "#0f1a2e" : isHovered ? "#1a1a2e" : "transparent",
                  opacity: isArchived ? 0.5 : 1,
                  minHeight: 28,
                  cursor: isOpen ? "default" : "pointer",
                }}
              >
                {/* Expand arrow */}
                <button
                  onClick={() => setExpandedMapId(isExpanded ? null : map.mapId)}
                  style={{
                    ...ghostBtn,
                    padding: "0 2px",
                    fontSize: 9,
                    color: sessionCount > 0 ? "#77aaff" : "#333",
                    visibility: (sessionCount > 0 || isExpanded) ? "visible" : "hidden",
                  }}
                >
                  {isExpanded ? "▼" : "▶"}
                </button>

                {/* Map name — click to select/inspect, double-click to open */}
                <span
                  onClick={() => onSelectMap?.(isSelected ? null : map)}
                  title={isOpen ? (isDirty ? "Unsaved changes — double-click to re-centre" : "Currently open in editor") : isSelected ? "Click to deselect" : "Click to inspect · double-click to open"}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    // Open file: bold + brighter, like VS Code active file
                    fontWeight: isOpen ? 600 : "normal",
                    color: isOpen ? "#aaddff" : isSelected ? "#7799ff" : isArchived ? "#555" : "#ccc",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  {isDirty && (
                    <span title="Unsaved changes" style={{ color: "#7ab4f5", fontSize: 16, lineHeight: 1, flexShrink: 0 }}>•</span>
                  )}
                </span>

                {/* Session count badge */}
                {sessionCount > 0 && (
                  <span style={{
                    background: "#1a3366",
                    color: "#7799ff",
                    border: "1px solid #2244aa",
                    borderRadius: 8,
                    fontSize: 9,
                    padding: "0 5px",
                    lineHeight: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    flexShrink: 0,
                  }} onClick={() => setExpandedMapId(isExpanded ? null : map.mapId)}>
                    {sessionCount}
                  </span>
                )}

                {/* Hover actions — always in DOM so row height stays fixed.
                    Dirty buffer: Save + Cancel (revert from server).
                    Clean buffer: activate session + archive. */}
                <div style={{ display: "flex", gap: 3, alignItems: "center", visibility: (isHovered && !isArchived) ? "visible" : "hidden" }}>
                  {isDirty ? (
                    <>
                      <button
                        onClick={() => void handleSave(map.mapId)}
                        disabled={saving}
                        title="Save to server"
                        style={primaryBtn}
                      >
                        {saving ? "…" : "Save"}
                      </button>
                      <button
                        onClick={() => void handleLoad(map.mapId)}
                        disabled={busy === `load-${map.mapId}`}
                        title="Discard changes and reload from server"
                        style={actionBtn}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Start session */}
                      <button
                        onClick={() => {
                          setStartFormMapId(startFormMapId === map.mapId ? null : map.mapId)
                          setExpandedMapId(map.mapId)
                          setSessionName("")
                        }}
                        title="Start session"
                        style={playBtn}
                      >
                        ▶
                      </button>

                      {/* Archive / delete */}
                      <button
                        onClick={() => void handleArchive(map.mapId)}
                        disabled={busy === `archive-${map.mapId}` || sessionCount > 0}
                        title={sessionCount > 0 ? "End all sessions first" : confirmArchiveId === map.mapId ? "Click again to confirm" : "Archive map"}
                        style={confirmArchiveId === map.mapId ? { ...dangerBtn, fontSize: 10 } : { ...ghostBtn, color: "#554", fontSize: 14, fontFamily: "'Noto Emoji', sans-serif" }}
                      >
                        {confirmArchiveId === map.mapId ? "sure?" : "❎"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Start session inline form */}
              {isExpanded && startFormMapId === map.mapId && (
                <div style={{
                  padding: "6px 8px 6px 24px",
                  background: "#0f0f22",
                  borderBottom: "1px solid #1a1a2e",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}>
                  {startStep ? (
                    <div style={{ fontSize: 9, color: "#7799ff", display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span>
                      {startStep}
                    </div>
                  ) : activeSessions.length > 0 ? (
                    <div style={{ fontSize: 9, color: "#cc8833" }}>
                      ⚠ Ends &ldquo;{activeSessions[0]!.name}&rdquo;{activeSessions.length > 1 ? ` +${activeSessions.length - 1} more` : ""}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Session name"
                      value={sessionName}
                      onChange={e => setSessionName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !startStep) void handleStartSession(map.mapId) }}
                      autoFocus
                      disabled={!!startStep}
                      style={{
                        flex: 1,
                        background: "#0e0e1c",
                        border: "1px solid #2a2a3e",
                        borderRadius: 3,
                        color: startStep ? "#555" : "#ccc",
                        fontSize: 11,
                        padding: "3px 6px",
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={() => void handleStartSession(map.mapId)}
                      disabled={!!startStep}
                      style={startStep
                        ? { ...actionBtn, color: "#7799ff", cursor: "default", minWidth: 52 }
                        : { ...primaryBtn, minWidth: 52 }}
                    >
                      {startStep ? "…" : "Start"}
                    </button>
                    <button
                      onClick={() => { setStartFormMapId(null); setSessionName("") }}
                      disabled={!!startStep}
                      style={{ ...actionBtn, opacity: startStep ? 0.3 : 1 }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Session child rows */}
              {isExpanded && mapSessions.map(session => {
                const isSessionSelected = selectedSessionId === session.id
                return (
                  <div key={session.id}
                    onClick={() => onSelectSession?.(isSessionSelected ? null : session.id)}
                    style={{
                      padding: "5px 8px 5px 24px",
                      borderBottom: "1px solid #1a1a2e",
                      background: isSessionSelected ? "#1a2244" : "#12122a",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      cursor: "pointer",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ flex: 1, fontSize: 11, color: isSessionSelected ? "#aaccff" : "#99bbff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {session.name}
                      </span>
                      {isSessionSelected && <span style={{ fontSize: 9, color: "#6688cc" }}>▶</span>}
                      {switchingSessionId === session.id ? (
                        <select
                          autoFocus
                          defaultValue=""
                          onClick={e => e.stopPropagation()}
                          onChange={e => { if (e.target.value) void handleSwitchMap(session.id, e.target.value) }}
                          onBlur={() => setSwitchingSessionId(null)}
                          style={{
                            background: "#1a1a2e",
                            border: "1px solid #2a2a3e",
                            borderRadius: 3,
                            color: "#ccc",
                            fontSize: 10,
                            padding: "1px 3px",
                          }}
                        >
                          <option value="" disabled>Switch to…</option>
                          {publishedMaps
                            .filter(m => !session.maps.some(sm => sm.mapId === m.mapId))
                            .map(m => (
                              <option key={m.mapId} value={m.mapId}>{m.name || m.mapId}</option>
                            ))}
                        </select>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setSwitchingSessionId(session.id) }}
                          disabled={busy === `switch-${session.id}`}
                          style={actionBtn}
                          title="Switch map"
                        >
                          Switch ▾
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); void handleEndSession(session.id) }}
                        disabled={busy === `end-${session.id}`}
                        style={dangerBtn}
                      >
                        End
                      </button>
                    </div>
                    <div style={{ fontSize: 9, color: "#444" }}>
                      started {new Date(session.startedAt).toLocaleTimeString()}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
