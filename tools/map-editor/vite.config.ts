import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import topLevelAwait from "vite-plugin-top-level-await"
import wasm from "vite-plugin-wasm"

/** wasm + topLevelAwait required for @relateby/pattern browser bundle */
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5181,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
