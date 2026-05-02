import { cellToBoundary } from "h3-js"
import { useEditor } from "../state/editor-context"
import type { ItemsLayerState, PolygonLayerState, TileLayerState } from "../state/editor-state"
import { h3Index as brandH3 } from "../types/map-gram"
import type { H3Index } from "../types/map-gram"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeBoundingBox(state: ReturnType<typeof useEditor>["state"]): string {
  const allCells: string[] = []
  for (const layer of state.layers) {
    if (layer.kind === "tile") {
      for (const h3 of layer.tiles.keys()) allCells.push(h3)
    } else if (layer.kind === "polygon") {
      for (const poly of layer.committed) allCells.push(...poly.cells)
    }
  }
  if (allCells.length === 0) return "—"

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const cell of allCells) {
    for (const [lat, lng] of cellToBoundary(cell)) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
  }
  return `${minLat.toFixed(4)},${minLng.toFixed(4)} → ${maxLat.toFixed(4)},${maxLng.toFixed(4)}`
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

const fieldStyle: React.CSSProperties = {
  width: "100%",
  background: "#0f1117",
  border: "1px solid #2a2a3e",
  borderRadius: 4,
  padding: "4px 6px",
  color: "#ddd",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#777",
  marginBottom: 2,
  display: "block",
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Map properties (no selection)
// ---------------------------------------------------------------------------

function MapProperties() {
  const { state, dispatch } = useEditor()
  const bbox = computeBoundingBox(state)

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>
        Map Properties
      </div>

      <Field label="Name">
        <input
          style={fieldStyle}
          value={state.meta.name}
          onChange={e => dispatch({ type: "UPDATE_META", payload: { name: e.target.value } })}
        />
      </Field>

      <Field label="Description">
        <textarea
          style={{ ...fieldStyle, resize: "vertical", minHeight: 48 }}
          value={state.meta.description ?? ""}
          onChange={e =>
            dispatch({ type: "UPDATE_META", payload: { description: e.target.value || undefined } })
          }
        />
      </Field>

      <Field label="Elevation">
        <input
          style={fieldStyle}
          type="number"
          value={state.meta.elevation}
          onChange={e =>
            dispatch({ type: "UPDATE_META", payload: { elevation: Number(e.target.value) } })
          }
        />
      </Field>

      <Field label="Bounding Box">
        <div style={{ ...fieldStyle, color: "#666", cursor: "default", userSelect: "none" }}>
          {bbox}
        </div>
      </Field>

      {state.rules.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: "#777", marginBottom: 4 }}>Movement Rules</div>
          <div style={{ ...fieldStyle, padding: "6px 8px", lineHeight: 1.8 }}>
            {state.rules.map((r, i) => (
              <div key={i} style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>
                {r.fromTypeName} → {r.toTypeName}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tile instance editor
// ---------------------------------------------------------------------------

function TileProperties({ layerId, h3 }: { layerId: string; h3: string }) {
  const { state, dispatch } = useEditor()
  const layer = state.layers.find(l => l.id === layerId) as TileLayerState | undefined
  const tile = layer?.tiles.get(brandH3(h3))

  if (!tile) {
    return <div style={{ padding: 10, fontSize: 11, color: "#555" }}>Tile not found: {h3}</div>
  }

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>
        Tile Properties
      </div>

      <Field label="H3 Index">
        <div style={{ ...fieldStyle, color: "#666", cursor: "default", userSelect: "none", fontFamily: "monospace", fontSize: 11 }}>
          {tile.h3Index}
        </div>
      </Field>

      <Field label="Type">
        <select
          style={{ ...fieldStyle, cursor: "pointer" }}
          value={tile.typeName}
          onChange={e =>
            dispatch({ type: "UPDATE_TILE_INSTANCE_TYPE", layerId, h3: tile.h3Index, typeName: e.target.value })
          }
        >
          {state.tileTypes.map(t => (
            <option key={t.id} value={t.typeName}>{t.name}</option>
          ))}
        </select>
      </Field>

      {tile.isOverride && (
        <div style={{ fontSize: 10, color: "#886", fontStyle: "italic", marginTop: -6, marginBottom: 8 }}>
          Overrides polygon tile
        </div>
      )}

      <button
        onClick={() => dispatch({ type: "ERASE_CELL", h3: tile.h3Index })}
        style={{
          width: "100%",
          padding: "4px 0",
          background: "#3a1111",
          color: "#ff8888",
          border: "1px solid #551111",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Delete Tile
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Polygon editor
// ---------------------------------------------------------------------------

function PolygonProperties({ layerId, id }: { layerId: string; id: string }) {
  const { state, dispatch } = useEditor()
  const layer = state.layers.find(l => l.id === layerId) as PolygonLayerState | undefined
  const poly = layer?.committed.find(p => p.id === id)

  if (!poly) {
    return <div style={{ padding: 10, fontSize: 11, color: "#555" }}>Polygon not found: {id}</div>
  }

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>
        Polygon Properties
      </div>

      <Field label="Type">
        <select
          style={{ ...fieldStyle, cursor: "pointer" }}
          value={poly.typeName}
          onChange={e => {
            void e
          }}
        >
          {state.tileTypes.map(t => (
            <option key={t.id} value={t.typeName}>{t.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Cells">
        <div style={{ ...fieldStyle, color: "#666", cursor: "default", fontSize: 11 }}>
          {poly.cells.length} cells
        </div>
      </Field>

      <button
        onClick={() => {
          dispatch({ type: "DELETE_POLYGON", layerId, id: poly.id })
          dispatch({ type: "DESELECT" })
        }}
        style={{
          width: "100%",
          padding: "4px 0",
          background: "#3a1111",
          color: "#ff8888",
          border: "1px solid #551111",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Delete Polygon
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Portal editor
// ---------------------------------------------------------------------------

function PortalProperties({ layerId, id }: { layerId: string; id: string }) {
  const { state, dispatch } = useEditor()
  const layer = state.layers.find(l => l.id === layerId) as TileLayerState | undefined
  const portal = layer?.portals.find(p => p.id === id)

  if (!portal) {
    return <div style={{ padding: 10, fontSize: 11, color: "#555" }}>Portal not found: {id}</div>
  }

  const PORTAL_MODES = ["Door", "Stairs", "Elevator", "Teleporter"]

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>
        Portal Properties
      </div>

      <Field label="From">
        <div style={{ ...fieldStyle, color: "#666", fontFamily: "monospace", fontSize: 10 }}>
          {portal.fromH3}
        </div>
      </Field>

      <Field label="To">
        <div style={{ ...fieldStyle, color: "#666", fontFamily: "monospace", fontSize: 10 }}>
          {portal.toH3}
        </div>
      </Field>

      <Field label="Mode">
        <input
          list="portal-modes"
          style={fieldStyle}
          value={portal.mode}
          onChange={e => dispatch({ type: "UPDATE_PORTAL_MODE", layerId, id: portal.id, mode: e.target.value })}
        />
        <datalist id="portal-modes">
          {PORTAL_MODES.map(m => <option key={m} value={m} />)}
        </datalist>
      </Field>

      <button
        onClick={() => {
          dispatch({ type: "DELETE_PORTAL", layerId, id: portal.id })
          dispatch({ type: "DESELECT" })
        }}
        style={{
          width: "100%",
          padding: "4px 0",
          background: "#3a1111",
          color: "#ff8888",
          border: "1px solid #551111",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Delete Portal
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Item editor
// ---------------------------------------------------------------------------

function ItemProperties({ layerId, id }: { layerId: string; id: string }) {
  const { state, dispatch } = useEditor()
  const layer = state.layers.find(l => l.id === layerId) as ItemsLayerState | undefined
  const item = layer?.items.find(i => i.id === id)

  if (!item) {
    return <div style={{ padding: 10, fontSize: 11, color: "#555" }}>Item not found: {id}</div>
  }

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", marginBottom: 10 }}>
        Item Properties
      </div>

      <Field label="Type">
        <div style={{ ...fieldStyle, color: "#666", cursor: "default", fontSize: 11 }}>{item.typeName}</div>
      </Field>

      <Field label="H3 Index">
        <div style={{ ...fieldStyle, color: "#666", cursor: "default", fontFamily: "monospace", fontSize: 11 }}>
          {item.h3Index}
        </div>
      </Field>

      <button
        onClick={() => {
          dispatch({ type: "REMOVE_ITEM", layerId, id: item.id })
          dispatch({ type: "DESELECT" })
        }}
        style={{
          width: "100%",
          padding: "4px 0",
          background: "#3a1111",
          color: "#ff8888",
          border: "1px solid #551111",
          borderRadius: 4,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Remove Item
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Selection dispatcher
// ---------------------------------------------------------------------------

function SelectedElementPanel() {
  const { state } = useEditor()
  const sel = state.ui.selectedElement
  if (!sel) return null

  if (sel.type === "tile") return <TileProperties layerId={sel.layerId} h3={sel.h3 as H3Index} />
  if (sel.type === "polygon") return <PolygonProperties layerId={sel.layerId} id={sel.id} />
  if (sel.type === "portal") return <PortalProperties layerId={sel.layerId} id={sel.id} />
  if (sel.type === "item") return <ItemProperties layerId={sel.layerId} id={sel.id} />

  return null
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function PropertyEditor() {
  const { state } = useEditor()
  const { selectedElement } = state.ui

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {selectedElement ? <SelectedElementPanel /> : <MapProperties />}
    </div>
  )
}
