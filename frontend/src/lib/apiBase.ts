/**
 * apiBase — the single place where the frontend decides where the backend
 * lives.
 *
 * Production (split deployment, e.g. Vercel SPA + hosted API):
 *   VITE_API_URL=https://campusnav-api.onrender.com   -> absolute base
 *
 * Same-origin / local development (Vite proxy strips /api):
 *   VITE_API_URL unset -> "" (relative /api/... paths)
 *
 * The value is baked at build time; no source-code edits are needed to move
 * between environments.
 */
const raw = import.meta.env.VITE_API_URL ?? "";
export const API_BASE = raw.replace(/\/+$/, "");