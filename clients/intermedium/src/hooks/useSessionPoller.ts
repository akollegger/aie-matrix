import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 4000;

export interface SessionInfo {
  id: string;
  name: string;
}

/**
 * Polls `GET /live?status=active` every 4 seconds.
 *
 * Returns the current active session (null when none exists).
 * Calls `onSessionChange` when a new non-null session ID is detected —
 * i.e. when a session appears for the first time or is replaced by a
 * different session. Session disappearing (→ null) does NOT fire the
 * callback; Intermedium simply waits for the next session to arrive.
 */
export function useSessionPoller(
  apiBase: string,
  onSessionChange: () => void,
): { readonly activeSession: SessionInfo | null } {
  const [activeSession, setActiveSession] = useState<SessionInfo | null>(null);

  // Track the previous session ID. undefined = not yet initialised.
  const prevIdRef = useRef<string | null | undefined>(undefined);

  // Keep a stable ref to the callback so the effect doesn't need to re-run
  // when the caller re-renders (retryMapLoad is already stable, but this is
  // defensive).
  const onChangeRef = useRef(onSessionChange);
  onChangeRef.current = onSessionChange;

  const fetchSession = useCallback(async (): Promise<SessionInfo | null> => {
    if (!apiBase) return null;
    try {
      const res = await fetch(
        `${apiBase.replace(/\/$/, "")}/live?status=active`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) return null;
      // GET /live returns a bare SessionRecord[]
      const data = (await res.json()) as SessionInfo[];
      return Array.isArray(data) ? (data[0] ?? null) : null;
    } catch {
      return null;
    }
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase) return;
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    async function tick(): Promise<void> {
      const session = await fetchSession();
      if (cancelled) return;

      setActiveSession(session);
      const newId = session?.id ?? null;

      // Fire only when a real session ID appears or changes — not on disappearance.
      if (
        prevIdRef.current !== undefined &&
        newId !== null &&
        newId !== prevIdRef.current
      ) {
        onChangeRef.current();
      }
      prevIdRef.current = newId;

      timerId = setTimeout(() => { void tick(); }, POLL_INTERVAL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [apiBase, fetchSession]);

  return { activeSession };
}
