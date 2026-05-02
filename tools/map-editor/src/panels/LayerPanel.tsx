import { useState } from "react"
import type { CSSProperties } from "react"
import { useEditor } from "../state/editor-context"
import type { MapLayer } from "../state/editor-state"

const KIND_ICON: Record<MapLayer["kind"], string> = {
  tile: "▦",
  polygon: "⬡",
  items: "📦",
}

const KIND_LABEL: Record<MapLayer["kind"], string> = {
  tile: "Tile",
  polygon: "Polygon",
  items: "Items",
}

function EyeIcon({ visible }: { visible: boolean }) {
  return <span style={{ opacity: visible ? 1 : 0.35, fontSize: 14, lineHeight: 1 }}>{visible ? "👁" : "🚫"}</span>
}

function LockIcon({ locked }: { locked: boolean }) {
  return <span style={{ opacity: locked ? 1 : 0.35, fontSize: 13, lineHeight: 1 }}>{locked ? "🔒" : "🔓"}</span>
}

const iconButton: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "2px 3px",
  borderRadius: 3,
  lineHeight: 1,
}

function LayerRow({ layer, active }: { layer: MapLayer; active: boolean }) {
  const { dispatch } = useEditor()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(layer.name)

  function commitRename() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== layer.name) {
      dispatch({ type: "RENAME_LAYER", layerId: layer.id, name: trimmed })
    } else {
      setDraft(layer.name)
    }
  }

  return (
    <div
      onClick={() => dispatch({ type: "SET_ACTIVE_LAYER", layerId: layer.id })}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "4px 8px",
        gap: 5,
        fontSize: 12,
        color: active ? "#ddf" : "#ccc",
        background: active ? "#1a2244" : "none",
        borderLeft: `3px solid ${active ? "#4488cc" : "transparent"}`,
        borderBottom: "1px solid #1e1e30",
        cursor: "pointer",
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); dispatch({ type: "SET_LAYER_VISIBILITY", layerId: layer.id, visible: !layer.visible }) }}
        title={layer.visible ? "Hide layer" : "Show layer"}
        style={iconButton}
      >
        <EyeIcon visible={layer.visible} />
      </button>
      <button
        onClick={e => { e.stopPropagation(); dispatch({ type: "SET_LAYER_LOCKED", layerId: layer.id, locked: !layer.locked }) }}
        title={layer.locked ? "Unlock layer" : "Lock layer"}
        style={iconButton}
      >
        <LockIcon locked={layer.locked} />
      </button>

      <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0 }} title={KIND_LABEL[layer.kind]}>
        {KIND_ICON[layer.kind]}
      </span>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === "Enter") commitRename()
            if (e.key === "Escape") { setEditing(false); setDraft(layer.name) }
          }}
          onClick={e => e.stopPropagation()}
          style={{
            flex: 1,
            background: "#0f1117",
            border: "1px solid #3366cc",
            borderRadius: 3,
            color: "#ddd",
            fontSize: 12,
            padding: "1px 4px",
            outline: "none",
          }}
        />
      ) : (
        <span
          style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}
        >
          {layer.name}
        </span>
      )}

      <button
        onClick={e => { e.stopPropagation(); dispatch({ type: "REMOVE_LAYER", layerId: layer.id }) }}
        title="Remove layer"
        style={{ ...iconButton, color: "#633", fontSize: 14 }}
      >
        ×
      </button>
    </div>
  )
}

export function LayerPanel() {
  const { state, dispatch } = useEditor()
  const [showKindMenu, setShowKindMenu] = useState(false)

  return (
    <div style={{ borderBottom: "1px solid #2a2a3e" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.05em",
          color: "#888",
          textTransform: "uppercase",
          background: "#11111f",
        }}
      >
        <span style={{ flex: 1 }}>Layers</span>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowKindMenu(v => !v)}
            title="Add layer"
            style={{ ...iconButton, color: "#558", fontSize: 14 }}
          >
            +
          </button>
          {showKindMenu && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                background: "#1a1a2e",
                border: "1px solid #2a2a3e",
                borderRadius: 4,
                zIndex: 100,
                minWidth: 120,
              }}
            >
              {(["tile", "polygon", "items"] as const).map(kind => (
                <button
                  key={kind}
                  onClick={() => {
                    setShowKindMenu(false)
                    dispatch({ type: "ADD_LAYER", kind, name: KIND_LABEL[kind] })
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "6px 10px",
                    background: "none",
                    border: "none",
                    color: "#ccc",
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {KIND_ICON[kind]} {KIND_LABEL[kind]} Layer
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {state.layers.slice().reverse().map(layer => (
        <LayerRow
          key={layer.id}
          layer={layer}
          active={layer.id === state.ui.activeLayerId}
        />
      ))}

      {/* Overlays */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 8px",
          gap: 5,
          fontSize: 11,
          color: "#888",
          borderTop: "1px solid #1e1e30",
          borderBottom: "1px solid #1e1e30",
          background: "#0f0f1a",
        }}
      >
        <button
          onClick={() => dispatch({ type: "SET_BOUNDING_BOX_VISIBILITY", visible: !state.ui.showBoundingBox })}
          title={state.ui.showBoundingBox ? "Hide bounding box" : "Show bounding box"}
          style={iconButton}
        >
          <EyeIcon visible={state.ui.showBoundingBox} />
        </button>
        <span style={{ flex: 1, color: state.ui.showBoundingBox ? "#f9a" : "#666" }}>Bounding Box</span>
      </div>
    </div>
  )
}
