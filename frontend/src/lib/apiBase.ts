/**
 * apiBase — the single place where the frontend decides where the backend
 * lives, plus the shared fetch helper that every API wrapper uses.
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

/** How long an API request may take before it is aborted. The Render free
 *  tier cold-starts in 30-60 s after idle, so this is generous but bounded —
 *  a hung request must never leave the UI spinning forever. */
export const API_TIMEOUT_MS = 35_000;

/**
 * fetchWithTimeout — fetch with a guaranteed abort. When the timeout fires
 * the promise rejects with a plain Error (message: "Request timed out") so
 * callers can translate it into a friendly "server is starting up" message
 * without needing to know about AbortController.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}