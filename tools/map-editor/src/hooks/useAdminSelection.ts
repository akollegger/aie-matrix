import { useState } from "react"
import type { ServerMapRecord } from "../services/mapServer"

export interface AdminSelection {
  /** A server-side map record clicked for detail inspection, or null. */
  selectedMap: ServerMapRecord | null
  selectedSessionId: string | null
  selectedAgentId: string | null
  selectedGhostSessionId: string | null
}

export interface AdminSelectionActions {
  selection: AdminSelection
  selectMap: (map: ServerMapRecord | null) => void
  selectSession: (id: string | null) => void
  selectAgent: (id: string | null) => void
  selectGhostSession: (id: string | null) => void
}

/**
 * Manages the Miller columns selection state for the admin panel.
 * Map detail ← sibling of → Sessions → Agent Catalog → Ghost Sessions
 *
 * Rules:
 *   selectMap(map)      → shows map detail; clears session/agent/ghost selection
 *   selectSession(id)   → opens CatalogPanel; clears map detail and agent/ghost selection
 *   selectAgent(id)     → opens GhostListPanel; clears ghost selection only
 *   selectGhostSession  → updates detail; clears nothing above
 *
 * Passing null to any action deselects that level and all levels below it.
 */
export function useAdminSelection(): AdminSelectionActions {
  const [selection, setSelection] = useState<AdminSelection>({
    selectedMap: null,
    selectedSessionId: null,
    selectedAgentId: null,
    selectedGhostSessionId: null,
  })

  const selectMap = (map: ServerMapRecord | null) => {
    setSelection({
      selectedMap: map,
      selectedSessionId: null,
      selectedAgentId: null,
      selectedGhostSessionId: null,
    })
  }

  const selectSession = (id: string | null) => {
    setSelection({
      selectedMap: null,
      selectedSessionId: id,
      selectedAgentId: null,
      selectedGhostSessionId: null,
    })
  }

  const selectAgent = (id: string | null) => {
    setSelection(prev => ({
      ...prev,
      selectedAgentId: id,
      selectedGhostSessionId: null,
    }))
  }

  const selectGhostSession = (id: string | null) => {
    setSelection(prev => ({
      ...prev,
      selectedGhostSessionId: id,
    }))
  }

  return { selection, selectMap, selectSession, selectAgent, selectGhostSession }
}
