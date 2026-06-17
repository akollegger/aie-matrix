import { useRef, useState } from "react"
import type { ChangeEvent, CSSProperties } from "react"
import { exportGram } from "../io/export-gram"
import { importGram } from "../io/import-gram"
import { listMaps, loadMapGram, publishMap } from "../services/mapServer"
import type { ServerMapRecord } from "../services/mapServer"
import { useEditor } from "../state/editor-context"
import type { ActiveTool } from "../state/editor-state"

const TOOLS: { id: ActiveTool; label: string; title: string }[] = [
  { id: "hand",       label: "✋",  title: "Select / move polygon" },
  { id: "paint",      label: "✏",  title: "Paint tile" },
  { id: "erase",      label: "⌫",  title: "Erase" },
  { id: "polygon",    label: "⬡",  title: "Place polygon" },
  { id: "portal",     label: "↔",  title: "Create portal" },
  { id: "place-item", label: "📦", title: "Place item" },
]

function slugId(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ToolPanel() {
  const { state, dispatch } = useEditor()
  const { activeTool } = state.ui
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [maps, setMaps] = useState<ServerMapRecord[] | null>(null)
  const [loadMenuOpen, setLoadMenuOpen] = useState(false)
  const [loadingMapId, setLoadingMapId] = useState<string | null>(null)

  function handleExport() {
    const gram = exportGram(state)
    const filename = `${state.meta.name.replace(/\s+/g, "-")}.map.gram`
    downloadFile(gram, filename)
  }

  async function handleSave() {
    setSaving(true)
    const mapId = slugId(state.meta.name) || "untitled"
    try {
      await publishMap(mapId, exportGram(state))
      dispatch({ type: "SET_HINT", hint: `Saved to server as "${mapId}"` })
      dispatch({ type: "SET_PUBLISHED_MAP_ID", mapId })
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Save failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSaving(false)
    }
  }

  async function handleOpenLoadMenu() {
    setLoadMenuOpen(v => !v)
    if (!loadMenuOpen) {
      setMaps(null)
      try {
        const result = await listMaps()
        setMaps(result)
      } catch (e) {
        dispatch({ type: "SET_HINT", hint: `Failed to fetch maps: ${e instanceof Error ? e.message : String(e)}` })
        setLoadMenuOpen(false)
      }
    }
  }

  async function handleLoadMap(mapId: string) {
    setLoadMenuOpen(false)
    setLoadingMapId(mapId)
    try {
      const gram = await loadMapGram(mapId)
      const { state: imported, warnings, leaderboards } = await importGram(gram)
      dispatch({ type: "IMPORT_MAP", state: { ...imported, leaderboards } })
      if (warnings.length > 0) {
        dispatch({ type: "SET_HINT", hint: `Import warnings: ${warnings.slice(0, 2).join("; ")}` })
      }
    } catch (e) {
      dispatch({ type: "SET_HINT", hint: `Load failed: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setLoadingMapId(null)
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async evt => {
      const text = evt.target?.result
      if (typeof text !== "string") return
      const { state: imported, warnings, leaderboards } = await importGram(text)
      dispatch({ type: "IMPORT_MAP", state: { ...imported, leaderboards } })
      if (warnings.length > 0) {
        dispatch({ type: "SET_HINT", hint: `Import warnings: ${warnings.slice(0, 2).join("; ")}` })
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const toolBtn = (active: boolean): CSSProperties => ({
    background: active ? "#2255aa" : "#1c1c30",
    color: active ? "#ddf" : "#888",
    border: `1px solid ${active ? "#3366cc" : "#2a2a3e"}`,
    borderRadius: 4,
    padding: "3px 8px",
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1,
  })

  const actionBtn: CSSProperties = {
    background: "#1c1c30",
    color: "#aaa",
    border: "1px solid #2a2a3e",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11,
    cursor: "pointer",
  }

  const primaryBtn: CSSProperties = {
    ...actionBtn,
    background: "#2255aa",
    color: "#ddf",
    border: "1px solid #3366cc",
  }

  return (
    <div style={{ background: "#11111f", borderBottom: "1px solid #2a2a3e", flexShrink: 0 }}>
      {/* Tool buttons */}
      <div style={{ display: "flex", gap: 4, padding: "6px 8px" }}>
        {TOOLS.map(t => (
          <button
            key={t.id}
            title={t.title}
            onClick={() => dispatch({ type: "SET_ACTIVE_TOOL", tool: t.id })}
            style={toolBtn(activeTool === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Map name + file + server buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px 6px", position: "relative" }}>
        <button
          title="Map properties"
          onClick={() => dispatch({ type: "DESELECT" })}
          style={{ ...actionBtn, padding: "2px 5px", fontSize: 13, lineHeight: 1, color: "#77aaff", border: "none", background: "none" }}
        >
          📄
        </button>
        <span style={{
          flex: 1, fontSize: 11, color: "#555",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {state.meta.name}
        </span>
        <button onClick={() => fileInputRef.current?.click()} style={{ ...actionBtn, color: "#8af" }}>
          Import
        </button>
        <button onClick={handleExport} style={actionBtn}>
          Export
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}
          title={`Save to server as "${slugId(state.meta.name) || "untitled"}"`}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <div style={{ position: "relative" }}>
          <button
            onClick={handleOpenLoadMenu}
            disabled={loadingMapId !== null}
            style={{ ...actionBtn, color: "#8af" }}
          >
            {loadingMapId ? "Loading…" : "Load ▾"}
          </button>
          {loadMenuOpen && (
            <div style={{
              position: "absolute", top: "100%", right: 0, zIndex: 100,
              background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 4,
              minWidth: 200, maxHeight: 240, overflowY: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}>
              {maps === null ? (
                <div style={{ padding: "8px 10px", fontSize: 11, color: "#666" }}>Loading…</div>
              ) : maps.length === 0 ? (
                <div style={{ padding: "8px 10px", fontSize: 11, color: "#666" }}>No published maps</div>
              ) : maps.map(m => (
                <button
                  key={m.mapId}
                  onClick={() => handleLoadMap(m.mapId)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "6px 10px", background: "none", border: "none",
                    borderBottom: "1px solid #2a2a3e", color: "#ccc",
                    fontSize: 11, cursor: "pointer",
                  }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.background = "#2255aa" }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.background = "none" }}
                >
                  <div style={{ fontWeight: 600 }}>{m.name || m.mapId}</div>
                  <div style={{ color: "#555", fontSize: 10 }}>{m.mapId}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gram"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}
