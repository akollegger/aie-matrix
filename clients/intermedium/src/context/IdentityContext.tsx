import { createContext, useContext, type ReactNode } from "react";
import { useIdentity, type Identity } from "../hooks/useIdentity.js";

const IdentityCtx = createContext<Identity | null>(null);

export function IdentityProvider({ children }: { readonly children: ReactNode }) {
  const identity = useIdentity(import.meta.env.VITE_API_BASE_URL ?? "");
  return <IdentityCtx.Provider value={identity}>{children}</IdentityCtx.Provider>;
}

export function useHumanIdentity(): Identity {
  const ctx = useContext(IdentityCtx);
  if (!ctx) throw new Error("useHumanIdentity must be used inside IdentityProvider");
  return ctx;
}
