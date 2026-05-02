import { useState } from "react"
import type { CSSProperties } from "react"
import { useEditor } from "../state/editor-context"
import type { ItemType } from "../types/map-gram"

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
  borderLeft: `3px solid ${active ? "#aa44cc" : "transparent"}`,
  cursor: "pointer",
  fontSize: 12,
  color: active ? "#ddf" : "#aaa",
})

function ItemTypeRow({
  itemType,
  active,
  onSelect,
}: {
  itemType: ItemType
  active: boolean
  onSelect: () => void
}) {
  const { dispatch } = useEditor()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(itemType.name)

  function commitEdit() {
    setEditing(false)
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== itemType.name) {
      dispatch({ type: "UPDATE_ITEM_TYPE", id: itemType.id, patch: { name: trimmed, typeName: toLabelSafe(trimmed) } })
    } else {
      setDraftName(itemType.name)
    }
  }

  return (
    <div>
      <div style={rowStyle(active)} onClick={onSelect}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{itemType.glyph || "?"}</span>

        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === "Enter") commitEdit()
              if (e.key === "Escape") { setEditing(false); setDraftName(itemType.name) }
            }}
            style={{
              flex: 1, background: "#0f1117", border: "1px solid #aa44cc",
              borderRadius: 3, color: "#ddd", fontSize: 12, padding: "1px 4px", outline: "none",
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span style={{ flex: 1 }} onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}>
            {itemType.name}
          </span>
        )}

        <button
          title="Delete item type"
          onClick={e => { e.stopPropagation(); dispatch({ type: "DELETE_ITEM_TYPE", id: itemType.id }) }}
          style={{ background: "none", border: "none", color: "#633", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {active && (
        <div style={{ padding: "6px 8px 8px 27px", background: "#141e38", borderBottom: "1px solid #1e2a44", display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#778" }}>
            Glyph
            <input
              value={itemType.glyph}
              onChange={e => dispatch({ type: "UPDATE_ITEM_TYPE", id: itemType.id, patch: { glyph: e.target.value } })}
              placeholder="emoji"
              style={{
                width: 36, textAlign: "center", fontSize: 16,
                background: "#0f1117", border: "1px solid #2a2a3e",
                borderRadius: 3, color: "#ddd", padding: "1px 4px", outline: "none",
              }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#778", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={itemType.takeable}
              onChange={e => dispatch({ type: "UPDATE_ITEM_TYPE", id: itemType.id, patch: { takeable: e.target.checked } })}
              style={{ accentColor: "#aa44cc" }}
            />
            Takeable
          </label>
        </div>
      )}
    </div>
  )
}

export function ItemTypePalette() {
  const { state, dispatch } = useEditor()
  const { activeTypeId } = state.ui

  const activeLayer = state.layers.find(l => l.id === state.ui.activeLayerId)
  if (!activeLayer || activeLayer.kind !== "items") return null

  function addItemType() {
    const id = `item-type-${Date.now().toString(36)}`
    dispatch({
      type: "CREATE_ITEM_TYPE",
      itemType: { id, typeName: "NewItem", name: "New Item", glyph: "📦", takeable: false },
    })
    dispatch({ type: "SET_ACTIVE_TYPE", typeId: id })
  }

  return (
    <div style={{ borderBottom: "1px solid #2a2a3e" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 8px", background: "#11111f", borderBottom: "1px solid #1e1e30" }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", color: "#888", textTransform: "uppercase" }}>
          Item Types
        </span>
        <button
          onClick={addItemType}
          title="Add item type"
          style={{ background: "none", border: "none", color: "#558", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
        >
          +
        </button>
      </div>

      {state.itemTypes.map(t => (
        <ItemTypeRow
          key={t.id}
          itemType={t}
          active={t.id === activeTypeId}
          onSelect={() => dispatch({ type: "SET_ACTIVE_TYPE", typeId: t.id })}
        />
      ))}
    </div>
  )
}
