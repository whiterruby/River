// vite.config.ts — Dev server & build settings for the Tauri v2 frontend.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: './', // relative paths — required for Tauri's file:// protocol
  server: {
    port: 1420, // must match devUrl in tauri.conf.json
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
