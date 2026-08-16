import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __PREMIUM__: JSON.stringify(process.env.PREMIUM === "true"),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy third-party libs get their own cacheable chunks.
          maplibre: ["maplibre-gl"],
          three: ["three"],
          motion: ["framer-motion"],
          icons: ["lucide-react"],
          radix: [
            "@radix-ui/react-checkbox",
            "@radix-ui/react-label",
            "@radix-ui/react-select",
            "@radix-ui/react-separator",
            "@radix-ui/react-slot",
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Phase 1: backend runs on :8000.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/auth": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true,
  },
});