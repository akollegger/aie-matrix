import path from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../../..");
  const env = loadEnv(mode, envDir, "");
  const gameServer = env.VITE_SERVER_HTTP ?? env.VITE_DEV_PROXY_TARGET ?? "http://127.0.0.1:8787";
  const mapPath = (env.AIE_MATRIX_MAP ?? "maps/sandbox/freeplay.tmj").replace(/^maps\//, "");

  return {
    root: path.resolve(__dirname),
    envDir,
    define: {
      __AIE_MAP_PATH__: JSON.stringify(mapPath),
    },
    server: {
      port: 5175,
      fs: {
        allow: [path.resolve(__dirname, "../../..")],
      },
      proxy: {
        "/spectator": { target: gameServer, changeOrigin: true },
        "/maps": { target: gameServer, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
