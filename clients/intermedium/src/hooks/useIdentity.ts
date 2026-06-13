import { useCallback, useEffect, useRef, useState } from "react";

const KEY_GHOST_ID = "aie-matrix.ghostId";
const KEY_DISPLAY_NAME = "aie-matrix.displayName";
const KEY_DISPLAY_NAME_LOCKED = "aie-matrix.displayNameLocked";

const ADJECTIVES = [
  "Amber", "Azure", "Bold", "Bright", "Calm", "Coral", "Deft", "Dusk", "Ember",
  "Fast", "Gilt", "Jade", "Keen", "Lunar", "Mossy", "Noble", "Opal", "Quick",
  "Russet", "Sage", "Sienna", "Slate", "Solar", "Starry", "Swift", "Teal",
  "Vivid", "Wild", "Wry", "Zeal",
];
const NOUNS = [
  "Badger", "Crane", "Elk", "Falcon", "Fox", "Heron", "Ibis", "Jay", "Kite",
  "Lark", "Lynx", "Mink", "Mole", "Newt", "Orca", "Osprey", "Otter", "Owl",
  "Pike", "Rail", "Raven", "Sage", "Seal", "Skink", "Snipe", "Stoat", "Swift",
  "Teal", "Vole", "Wren",
];

function generateDisplayName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  return `${adj}${noun}`;
}

function getOrCreateGhostId(): string {
  const stored = localStorage.getItem(KEY_GHOST_ID);
  if (stored && stored.trim().length > 0) return stored.trim();
  const id = crypto.randomUUID();
  localStorage.setItem(KEY_GHOST_ID, id);
  return id;
}

function getOrCreateDisplayName(): string {
  const stored = localStorage.getItem(KEY_DISPLAY_NAME);
  if (stored && stored.trim().length > 0) return stored.trim();
  const name = generateDisplayName();
  localStorage.setItem(KEY_DISPLAY_NAME, name);
  return name;
}

export interface Identity {
  ghostId: string;
  displayName: string;
  token: string | null;
  displayNameLocked: boolean;
  setDisplayName: (name: string) => void;
}

/**
 * Stable human identity backed by localStorage.
 * - ghostId: persisted UUID (created once per browser profile)
 * - displayName: auto-generated on first visit; editable once
 * - token: guest JWT from POST /auth/guest; null until fetched
 */
export function useIdentity(worldApiBaseUrl: string): Identity {
  const [ghostId] = useState(() => getOrCreateGhostId());
  const [displayName, setDisplayNameState] = useState(() => getOrCreateDisplayName());
  const [displayNameLocked, setDisplayNameLocked] = useState(
    () => localStorage.getItem(KEY_DISPLAY_NAME_LOCKED) === "true",
  );
  const [token, setToken] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !worldApiBaseUrl || !ghostId) return;
    fetchedRef.current = true;

    const base = worldApiBaseUrl.endsWith("/")
      ? worldApiBaseUrl.slice(0, -1)
      : worldApiBaseUrl;

    const fetchToken = async () => {
      try {
        const res = await fetch(`${base}/auth/guest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ghostId }),
        });
        if (!res.ok) {
          console.warn("[identity] POST /auth/guest failed:", res.status);
          return;
        }
        const body = (await res.json()) as { token?: string };
        if (body.token) setToken(body.token);
      } catch (e) {
        console.warn("[identity] POST /auth/guest error:", e);
      }
    };

    void fetchToken();
  }, [worldApiBaseUrl, ghostId]);

  const setDisplayName = useCallback(
    (name: string) => {
      if (displayNameLocked) return;
      const trimmed = name.trim().slice(0, 64);
      if (!trimmed) return;
      localStorage.setItem(KEY_DISPLAY_NAME, trimmed);
      localStorage.setItem(KEY_DISPLAY_NAME_LOCKED, "true");
      setDisplayNameState(trimmed);
      setDisplayNameLocked(true);
    },
    [displayNameLocked],
  );

  return { ghostId, displayName, token, displayNameLocked, setDisplayName };
}
