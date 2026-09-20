import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// Tauri's Windows runtime is WebView2, and managed enterprise machines can lag
// behind Vite's moving default browser baseline. Keep the generated syntax at a
// known WebView2-safe level instead of silently inheriting a newer Vite target.
// @ts-expect-error process is a nodejs global
const platform = process.env.TAURI_ENV_PLATFORM;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  build: {
    target: platform === "windows" ? "chrome95" : "safari13",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
