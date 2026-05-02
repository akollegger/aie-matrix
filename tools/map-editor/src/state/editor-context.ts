import { createContext, useContext } from "react"
import type { Dispatch } from "react"
import type { MapEditorState } from "./editor-state"
import type { EditorAction } from "./editor-reducer"

export interface EditorContextValue {
  state: MapEditorState
  dispatch: Dispatch<EditorAction>
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext)
  if (!ctx) throw new Error("useEditor must be used inside <MapEditor>")
  return ctx
}
