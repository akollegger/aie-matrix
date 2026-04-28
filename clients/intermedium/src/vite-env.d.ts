/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COLYSEUS_URL: string;
  readonly VITE_WORLD_API_URL: string;
  readonly VITE_GHOST_HOUSE_URL: string;
  readonly VITE_MAP_ID: string;
  readonly VITE_DEV_GHOST_ID: string;
  /** Optional bearer for `GET /v1/catalog` and A2A HTTP stubs */
  readonly VITE_GHOST_HOUSE_BEARER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
