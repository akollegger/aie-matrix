import { useRef } from "react"
import { exportGram } from "../io/export-gram"
import { importGram } from "../io/import-gram"
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

  function handleExport() {
    const gram = exportGram(state)
    const filename = `${state.meta.name.replace(/\s+/g, "-")}.map.gram`
    downloadFile(gram, filename)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async evt => {
      const text = evt.target?.result
      if (typeof text !== "string") return
      const { state: imported, warnings } = await importGram(text)
      dispatch({ type: "IMPORT_MAP", state: imported })
      if (warnings.length > 0) {
        dispatch({ type: "SET_HINT", hint: `Import warnings: ${warnings.slice(0, 2).join("; ")}` })
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const toolBtn = (active: boolean): React.CSSProperties => ({
    background: active ? "#2255aa" : "#1c1c30",
    color: active ? "#ddf" : "#888",
    border: `1px solid ${active ? "#3366cc" : "#2a2a3e"}`,
    borderRadius: 4,
    padding: "3px 8px",
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1,
  })

  const actionBtn: React.CSSProperties = {
    background: "#1c1c30",
    color: "#aaa",
    border: "1px solid #2a2a3e",
    borderRadius: 4,
    padding: "2px 7px",
    fontSize: 11,
    cursor: "pointer",
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

      {/* Map name + Import / Export */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px 6px" }}>
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
        <button
          onClick={handleExport}
          style={{ ...actionBtn, background: "#2255aa", color: "#ddf", border: "1px solid #3366cc" }}
        >
          Export
        </button>
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
