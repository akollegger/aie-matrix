import { useReducer } from "react"
import { App } from "./App"
import { EditorContext } from "./state/editor-context"
import { editorReducer, makeInitialState } from "./state/editor-reducer"

export function MapEditor() {
  const [state, dispatch] = useReducer(editorReducer, undefined, makeInitialState)

  return (
    <EditorContext.Provider value={{ state, dispatch }}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {state.ui.hint && (
          <div style={{
            background: "#2a1a00",
            borderBottom: "1px solid #3a2800",
            padding: "3px 10px",
            fontSize: 11,
            color: "#c8a040",
            flexShrink: 0,
          }}>
            {state.ui.hint}
          </div>
        )}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <App />
        </div>
      </div>
    </EditorContext.Provider>
  )
}
