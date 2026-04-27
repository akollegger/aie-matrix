import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ClientState } from "../types/clientState.js";
import { usePairing } from "./PairingContext.js";
import { useGhostIdentity } from "../hooks/useGhostIdentity.js";
import { useMapGram } from "../hooks/useMapGram.js";
import { useColyseus } from "../hooks/useColyseus.js";
import { useViewState } from "../hooks/useViewState.js";

const ClientStateCtx = createContext<ClientState | null>(null);
const RefreshIdentitiesCtx = createContext<() => void>(() => {});

/**
 * Composes map topology, live ghosts, catalog, and view navigation.
 * @see `data-model.md` (ClientState, composed)
 */
export function ClientStateProvider({ children }: { readonly children: ReactNode }) {
  const pairing = usePairing();
  const { identities, refresh } = useGhostIdentity(import.meta.env.VITE_GHOST_HOUSE_URL ?? "");
  const { status: mapGramStatus, tiles, error: mapGramError, retry: retryMapLoad } = useMapGram();
  const { ghosts, connectionState: colyseusLinkState } = useColyseus();
  const { viewState, nav } = useViewState(pairing);
  const [thread] = useState<ClientState["thread"]>(null);
  const [interiority] = useState<ClientState["interiority"]>(null);

  const value = useMemo(
    (): ClientState => ({
      viewState,
      nav,
      ghosts,
      identities,
      tiles,
      thread,
      interiority,
      pairing,
      mapGramStatus,
      mapGramError,
      colyseusLinkState,
      retryMapLoad,
    }),
    [
      viewState,
      nav,
      ghosts,
      identities,
      tiles,
      thread,
      interiority,
      pairing,
      mapGramStatus,
      mapGramError,
      colyseusLinkState,
      retryMapLoad,
    ],
  );

  return (
    <RefreshIdentitiesCtx.Provider value={refresh}>
      <ClientStateCtx.Provider value={value}>{children}</ClientStateCtx.Provider>
    </RefreshIdentitiesCtx.Provider>
  );
}

export function useClientState(): ClientState {
  const v = useContext(ClientStateCtx);
  if (!v) {
    throw new Error("useClientState must be used under ClientStateProvider");
  }
  return v;
}

export function useRefreshIdentities(): () => void {
  return useContext(RefreshIdentitiesCtx);
}
