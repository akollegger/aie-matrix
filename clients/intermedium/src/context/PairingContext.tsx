import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { HumanPairing } from "../types/ghost.js";

const PairingContext = createContext<HumanPairing | null>(null);

function readPairingFromLocation(): HumanPairing | null {
  const fromUrl = new URLSearchParams(window.location.search).get("ghost");
  if (fromUrl) {
    return { ghostId: fromUrl };
  }
  const dev = import.meta.env.VITE_DEV_GHOST_ID;
  if (dev && String(dev).length > 0) {
    return { ghostId: String(dev) };
  }
  return null;
}

/**
 * @see FR-013 — `?ghost=` and optional `VITE_DEV_GHOST_ID`
 */
export function PairingProvider({ children }: { readonly children: ReactNode }) {
  const pairing = useMemo(() => readPairingFromLocation(), []);
  return <PairingContext.Provider value={pairing}>{children}</PairingContext.Provider>;
}

export function usePairing(): HumanPairing | null {
  return useContext(PairingContext);
}
