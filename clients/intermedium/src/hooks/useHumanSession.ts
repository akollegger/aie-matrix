const STORAGE_KEY = "aie-matrix.humanId";

/**
 * Returns a stable humanId for this browser session, persisted in localStorage.
 * Purely client-side — no server call required.
 */
export function useHumanSession(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  const id = stored && stored.trim().length > 0 ? stored.trim() : crypto.randomUUID();
  if (!stored) localStorage.setItem(STORAGE_KEY, id);
  return id;
}
