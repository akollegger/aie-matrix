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

/** Injected at build time by vite.config.ts from AIE_MATRIX_MAP (strips leading `maps/`). */
declare const __AIE_MAP_PATH__: string;

/**
 * Injected at build time from SPECTATOR_DEBUG_TOKEN (repo-root .env).
 * Empty string when not set — the server reads the same env var, keeping both sides in sync.
 */
declare const __SPECTATOR_DEBUG_TOKEN__: string;
