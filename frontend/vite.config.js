import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
        proxy: {
            // Phase 1: backend runs on :8000.
            "/api": {
                target: "http://localhost:8000",
                changeOrigin: true,
                rewrite: function (p) { return p.replace(/^\/api/, ""); },
            },
            "/auth": "http://localhost:8000",
            "/health": "http://localhost:8000",
        },
    },
});
