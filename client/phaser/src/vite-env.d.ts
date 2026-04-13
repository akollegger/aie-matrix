/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_HTTP?: string;
  /** Dev-only: same default as Vite’s `/spectator` proxy target (`vite.config.ts`). */
  readonly VITE_DEV_PROXY_TARGET?: string;
  /** WebSocket root for Colyseus (default: derive from the resolved HTTP base). */
  readonly VITE_SERVER_WS?: string;
  /** When `"true"`, enables spectator HUD + console logs (also `?debug=1` in URL). */
  readonly VITE_SPECTATOR_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
