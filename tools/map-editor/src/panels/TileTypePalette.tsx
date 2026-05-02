import { useState } from "react"
import type { CSSProperties } from "react"
import { useEditor } from "../state/editor-context"
import { BUILTIN_FLOOR_ID } from "../state/editor-reducer"
import type { TileType } from "../types/map-gram"

function toLabelSafe(name: string): string {
  return name.trim().split(/[^a-zA-Z0-9]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Type"
}

const rowStyle = (active: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  background: active ? "#1a2a4a" : "none",
  borderLeft: `3px solid ${active ? "#4488cc" : "transparent"}`,
  cursor: "pointer",
  fontSize: 12,
  color: active ? "#ddf" : "#aaa",
})

function extractHexColor(style: string | undefined): string {
  const match = style?.match(/background:\s*(#[0-9a-fA-F]{3,8})/)?.[1]
  if (match) {
    if (/^#[0-9a-fA-F]{3}$/.test(match)) {
      const r = match[1]!, g = match[2]!, b = match[3]!
      return `#${r}${r}${g}${g}${b}${b}`
    }
    return match.length > 7 ? match.slice(0, 7) : match
  }
  return "#446688"
}

function TileTypeRow({
  tileType,
  active,
  onSelect,
}: {
  tileType: TileType
  active: boolean
  onSelect: () => void
}) {
  const { dispatch } = useEditor()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(tileType.name)
  const isBuiltin = tileType.id === BUILTIN_FLOOR_ID

  const bg = extractHexColor(tileType.style)

  function commitEdit() {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== tileType.name) {
      dispatch({ type: "UPDATE_TILE_TYPE", id: tileType.id, patch: { name: trimmed, typeName: toLabelSafe(trimmed) } })
    } else {
      setDraftName(tileType.name)
    }
  }

  return (
    <div>
      <div style={rowStyle(active)} onClick={onSelect}>
        <div style={{
          width: 14, height: 14, borderRadius: 3,
          background: bg, flexShrink: 0, border: "1px solid #444",
        }} />

        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === "Enter") commitEdit()
              if (e.key === "Escape") { setEditing(false); setDraftName(tileType.name) }
            }}
            style={{
              flex: 1, background: "#0f1117", border: "1px solid #3366cc",
              borderRadius: 3, color: "#ddd", fontSize: 12, padding: "1px 4px", outline: "none",
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{ flex: 1 }} onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}>
            {tileType.name}
          </span>
        )}

        {!isBuiltin && !editing && (
          <button
            title="Delete tile type"
            onClick={e => { e.stopPropagation(); dispatch({ type: "DELETE_TILE_TYPE", id: tileType.id }) }}
            style={{ background: "none", border: "none", color: "#633", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      {active && (
        <div style={{ padding: "6px 8px 8px 27px", background: "#141e38", borderBottom: "1px solid #1e2a44" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#778" }}>
            Color
            <input
              type="color"
              value={bg}
              onChange={e =>
                dispatch({ type: "UPDATE_TILE_TYPE", id: tileType.id, patch: { style: `background: ${e.target.value}` } })
              }
              style={{ width: 28, height: 18, padding: 0, border: "1px solid #444", borderRadius: 3, cursor: "pointer", background: "none" }}
            />
            <span style={{ fontFamily: "monospace", fontSize: 10, color: "#556" }}>{bg}</span>
          </label>
        </div>
      )}
    </div>
  )
}

export function TileTypePalette() {
  const { state, dispatch } = useEditor()
  const { activeTypeId } = state.ui

  const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
  if (!activeLayer || activeLayer.kind !== "tile") return null

  function addType() {
    const id = `type-${Date.now().toString(36)}`
    dispatch({ type: "CREATE_TILE_TYPE", tileType: { id, typeName: "NewType", name: "New Type" } })
    dispatch({ type: "SET_ACTIVE_TYPE", typeId: id })
  }

  return (
    <div style={{ borderBottom: "1px solid #2a2a3e" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 8px", background: "#11111f", borderBottom: "1px solid #1e1e30" }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", color: "#888", textTransform: "uppercase" }}>
          Tile Types
        </span>
        <button
          onClick={addType}
          title="Add tile type"
          style={{ background: "none", border: "none", color: "#558", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
        >
          +
        </button>
      </div>

      {state.tileTypes.map(t => (
        <TileTypeRow
          key={t.id}
          tileType={t}
          active={t.id === activeTypeId}
          onSelect={() => dispatch({ type: "SET_ACTIVE_TYPE", typeId: t.id })}
        />
      ))}
    </div>
  )
}
