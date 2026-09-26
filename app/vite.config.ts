import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  preview: { port: 1420, strictPort: true, host: "127.0.0.1" },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2021",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        palette: resolve(import.meta.dirname, "palette.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
