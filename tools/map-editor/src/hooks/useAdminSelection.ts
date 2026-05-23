import { useState } from "react"

export interface AdminSelection {
  selectedSessionId: string | null
  selectedAgentId: string | null
  selectedGhostSessionId: string | null
}

export interface AdminSelectionActions {
  selection: AdminSelection
  selectSession: (id: string | null) => void
  selectAgent: (id: string | null) => void
  selectGhostSession: (id: string | null) => void
}

/**
 * Manages the three-level Miller columns selection state for the admin panel.
 * Maps → Sessions → Agent Catalog → Ghost Sessions
 *
 * Clearing a level automatically clears all deeper levels:
 *   selectSession(null) → clears selectedAgentId and selectedGhostSessionId
 *   selectAgent(null)   → clears selectedGhostSessionId only
 */
export function useAdminSelection(): AdminSelectionActions {
  const [selection, setSelection] = useState<AdminSelection>({
    selectedSessionId: null,
    selectedAgentId: null,
    selectedGhostSessionId: null,
  })

  const selectSession = (id: string | null) => {
    setSelection({
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

  return { selection, selectSession, selectAgent, selectGhostSession }
}
