import path from "node:path";
import { defineConfig } from "vite";

/** Must match Colyseus HTTP/WS base in `src/main.ts` when using the dev proxy. */
const gameServer =
  process.env.VITE_SERVER_HTTP ?? process.env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  root: path.resolve(__dirname),
  /** Repo-root `.env` / `.env.local` so `VITE_*` matches other processes’ config. */
  envDir: path.resolve(__dirname, "../.."),
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
});
