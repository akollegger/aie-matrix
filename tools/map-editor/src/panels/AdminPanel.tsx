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

export function AdminPanel() {
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

  // Editor buffer identity
  const editorMapId = slugId(state.meta.name) || "untitled"
  const editorIsPublished = state.ui.publishedMapId !== null
  const editorSessions = useMemo(
    () => sessions.filter(s => (s.maps.find(m => m.role === "primary") ?? s.maps[0])?.mapId === editorMapId),
    [sessions, editorMapId],
  )

  async function handleEditorSave() {
    setSaving(true)
    try {
      await publishMap(editorMapId, exportGram(state))
      dispatch({ type: "SET_HINT", hint: `Saved as "${editorMapId}"` })
      dispatch({ type: "SET_PUBLISHED_MAP_ID", mapId: editorMapId })
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Save failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSaving(false)
    }
  }

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

  async function handleLoad(mapId: string) {
    setBusy(`load-${mapId}`)
    try {
      const gram = await loadMapGram(mapId)
      const { state: imported, warnings } = await importGram(gram)
      dispatch({ type: "IMPORT_MAP", state: imported })
      dispatch({ type: "SET_HINT", hint: warnings.length > 0 ? `Loaded with warnings: ${warnings.slice(0, 2).join("; ")}` : `Loaded "${mapId}"` })
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Load failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
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
      await startSession(name, mapId)
      dispatch({ type: "SET_HINT", hint: `Session "${name}" started` })
      setStartFormMapId(null)
      setSessionName("")
      void refresh()
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Start session failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
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

      {/* Map list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Editor buffer — always shown at top */}
        {(() => {
          const isHovered = hoveredMapId === "@editor"
          const isExpanded = expandedMapId === "@editor"
          return (
            <div>
              <div
                onMouseEnter={() => setHoveredMapId("@editor")}
                onMouseLeave={() => setHoveredMapId(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "5px 8px", borderBottom: "1px solid #1a1a2e",
                  background: isHovered ? "#1a1a2e" : "#0f0f1e",
                  minHeight: 28,
                }}
              >
                <button
                  onClick={() => setExpandedMapId(isExpanded ? null : "@editor")}
                  style={{
                    ...ghostBtn, padding: "0 2px", fontSize: 9,
                    color: editorSessions.length > 0 ? "#77aaff" : "#333",
                    visibility: (editorSessions.length > 0 || isExpanded) ? "visible" : "hidden",
                  }}
                >{isExpanded ? "▼" : "▶"}</button>

                <span style={{ flex: 1, overflow: "hidden" }}>
                  <span style={{ fontSize: 11, color: "#ddf", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {state.meta.name || "untitled-map"}
                  </span>
                  <span style={{ fontSize: 9, color: "#445" }}>{editorMapId}</span>
                </span>

                <span style={{
                  fontSize: 9, padding: "1px 5px", borderRadius: 3,
                  background: editorIsPublished ? "#1a3366" : "#2a1a00",
                  color: editorIsPublished ? "#7799ff" : "#cc8833",
                  border: `1px solid ${editorIsPublished ? "#2244aa" : "#443300"}`,
                }}>
                  {editorIsPublished ? "saved" : "local"}
                </span>

                {editorSessions.length > 0 && (
                  <span style={{
                    background: "#1a3366", color: "#7799ff", border: "1px solid #2244aa",
                    borderRadius: 8, fontSize: 9, padding: "0 5px", lineHeight: "14px", fontWeight: 600, cursor: "pointer",
                  }} onClick={() => setExpandedMapId(isExpanded ? null : "@editor")}>
                    {editorSessions.length}
                  </span>
                )}

                {isHovered && (
                  <div style={{ display: "flex", gap: 3 }}>
                    <button onClick={() => void handleEditorSave()} disabled={saving} style={primaryBtn}>
                      {saving ? "…" : "Save"}
                    </button>
                    {editorIsPublished && (
                      <button
                        onClick={() => { setStartFormMapId("@editor"); setExpandedMapId("@editor"); setSessionName("") }}
                        style={primaryBtn}
                      >+ Session</button>
                    )}
                  </div>
                )}
              </div>

              {/* New session form for editor buffer */}
              {isExpanded && startFormMapId === "@editor" && (
                <div style={{
                  padding: "6px 8px 6px 24px", background: "#0f0f22",
                  borderBottom: "1px solid #1a1a2e", display: "flex", gap: 4, alignItems: "center",
                }}>
                  <input
                    type="text" placeholder="Session name" value={sessionName}
                    onChange={e => setSessionName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void handleStartSession(editorMapId) }}
                    autoFocus
                    style={{
                      flex: 1, background: "#0e0e1c", border: "1px solid #2a2a3e",
                      borderRadius: 3, color: "#ccc", fontSize: 11, padding: "3px 6px", outline: "none",
                    }}
                  />
                  <button onClick={() => void handleStartSession(editorMapId)} disabled={busy === `start-${editorMapId}`} style={primaryBtn}>Start</button>
                  <button onClick={() => { setStartFormMapId(null); setSessionName("") }} style={actionBtn}>✕</button>
                </div>
              )}

              {isExpanded && editorSessions.map(session => (
                <div key={session.id} style={{
                  padding: "5px 8px 5px 24px", borderBottom: "1px solid #1a1a2e",
                  background: "#12122a", display: "flex", flexDirection: "column", gap: 3,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ flex: 1, fontSize: 11, color: "#99bbff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.name}</span>
                    <button onClick={() => void handleEndSession(session.id)} disabled={busy === `end-${session.id}`} style={dangerBtn}>End</button>
                  </div>
                  <div style={{ fontSize: 9, color: "#444" }}>started {new Date(session.startedAt).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Server maps — excluding any that match the editor buffer */}
        {maps.filter(m => m.mapId !== editorMapId).map(map => {
          const mapSessions = sessionsByMapId.get(map.mapId) ?? []
          const sessionCount = mapSessions.length
          const isExpanded = expandedMapId === map.mapId
          const isHovered = hoveredMapId === map.mapId
          const isArchived = map.status === "archived"
          const label = map.name || map.mapId

          return (
            <div key={map.mapId}>
              {/* Map row */}
              <div
                onMouseEnter={() => setHoveredMapId(map.mapId)}
                onMouseLeave={() => { setHoveredMapId(null); setConfirmArchiveId(null) }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 8px",
                  borderBottom: "1px solid #1a1a2e",
                  background: isHovered ? "#1a1a2e" : "transparent",
                  opacity: isArchived ? 0.5 : 1,
                  minHeight: 28,
                }}
              >
                {/* Expand arrow — only visible when there are sessions or row is expanded */}
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

                <span style={{
                  flex: 1,
                  fontSize: 11,
                  color: isArchived ? "#555" : "#ccc",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {label}
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
                  }} onClick={() => setExpandedMapId(isExpanded ? null : map.mapId)}>
                    {sessionCount}
                  </span>
                )}

                {/* Hover actions */}
                {isHovered && (
                  <div style={{ display: "flex", gap: 3 }}>
                    <button
                      onClick={() => void handleLoad(map.mapId)}
                      disabled={busy === `load-${map.mapId}`}
                      style={actionBtn}
                    >
                      Load
                    </button>
                    {!isArchived && (
                      <>
                        <button
                          onClick={() => {
                            setStartFormMapId(startFormMapId === map.mapId ? null : map.mapId)
                            setExpandedMapId(map.mapId)
                            setSessionName("")
                          }}
                          style={primaryBtn}
                        >
                          + Session
                        </button>
                        <button
                          onClick={() => void handleArchive(map.mapId)}
                          disabled={busy === `archive-${map.mapId}` || sessionCount > 0}
                          title={sessionCount > 0 ? "End all sessions first" : confirmArchiveId === map.mapId ? "Click again to confirm" : "Archive map"}
                          style={confirmArchiveId === map.mapId ? dangerBtn : actionBtn}
                        >
                          {confirmArchiveId === map.mapId ? "Sure?" : "Archive"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* New session inline form */}
              {isExpanded && startFormMapId === map.mapId && (
                <div style={{
                  padding: "6px 8px 6px 24px",
                  background: "#0f0f22",
                  borderBottom: "1px solid #1a1a2e",
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                }}>
                  <input
                    type="text"
                    placeholder="Session name"
                    value={sessionName}
                    onChange={e => setSessionName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void handleStartSession(map.mapId) }}
                    autoFocus
                    style={{
                      flex: 1,
                      background: "#0e0e1c",
                      border: "1px solid #2a2a3e",
                      borderRadius: 3,
                      color: "#ccc",
                      fontSize: 11,
                      padding: "3px 6px",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => void handleStartSession(map.mapId)}
                    disabled={busy === `start-${map.mapId}`}
                    style={primaryBtn}
                  >
                    Start
                  </button>
                  <button
                    onClick={() => { setStartFormMapId(null); setSessionName("") }}
                    style={actionBtn}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Session child rows */}
              {isExpanded && mapSessions.map(session => (
                <div key={session.id} style={{
                  padding: "5px 8px 5px 24px",
                  borderBottom: "1px solid #1a1a2e",
                  background: "#12122a",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ flex: 1, fontSize: 11, color: "#99bbff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {session.name}
                    </span>
                    {switchingSessionId === session.id ? (
                      <select
                        autoFocus
                        defaultValue=""
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
                        onClick={() => setSwitchingSessionId(session.id)}
                        disabled={busy === `switch-${session.id}`}
                        style={actionBtn}
                        title="Switch map"
                      >
                        Switch ▾
                      </button>
                    )}
                    <button
                      onClick={() => void handleEndSession(session.id)}
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
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
