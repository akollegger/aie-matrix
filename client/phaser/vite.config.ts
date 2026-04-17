import path from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envDir, "");

  /** Must match Colyseus HTTP/WS base in `src/main.ts` when using the dev proxy. */
  const gameServer =
    env.VITE_SERVER_HTTP ?? env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:8787";

  /**
   * Derive client map path from the shared AIE_MATRIX_MAP env var by stripping the leading `maps/`.
   * Only repo-relative paths starting with `maps/` are valid here; absolute filesystem paths are
   * meaningful to the server but cannot be converted into a browser-accessible URL.
   */
  const mapPath = (env.AIE_MATRIX_MAP ?? "maps/sandbox/freeplay.tmj").replace(/^maps\//, "");

  return {
    root: path.resolve(__dirname),
    /** Repo-root `.env` / `.env.local` so `VITE_*` matches other processes’ config. */
    envDir,
    define: {
      /** Injected at build time from AIE_MATRIX_MAP — do not set VITE_MAP_PATH directly. */
      __AIE_MAP_PATH__: JSON.stringify(mapPath),
    },
    server: {
      port: 5174,
      fs: {
        allow: [path.resolve(__dirname, "../..")],
      },
      proxy: {
        // Same-origin in dev → avoids browser CORS on Colyseus matchmake when needed.
        "/spectator": { target: gameServer, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
