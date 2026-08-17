# CROSS_DEVICE_MAP_AUDIT.md — CampusNav V2 map visibility on Windows / Android

Audit + fix run: 2026-08-17. Scope: make the EXISTING MapLibre map render
reliably across macOS Safari, macOS Chrome, Windows Chrome/Edge, Android
Chrome and common mobile viewports. No renderer/provider replacement, no
redesign.

## A. Problem

The map rendered on the developer's Mac (Safari) but was invisible / cut
off on Windows laptops and Android phones. Production URL:
https://campusnav-v2.vercel.app (map route behind login).

## B. Root cause

**CSS cascade-layer conflict between `maplibre-gl.css` and Tailwind.**

- The MapLibre container div is styled with Tailwind utilities
  (`absolute inset-0`, i.e. fill the parent).
- Tailwind v3 emits its utilities inside `@layer utilities` — a real CSS
  cascade layer.
- `maplibre-gl.css` is loaded as plain (unlayered) CSS, and its rule
  `.maplibregl-map { position: relative; overflow: hidden; }` is
  **unlayered**. Per the CSS spec, *unlayered author styles always beat
  layered styles*, regardless of source order or specificity.
- Result: computed `position: relative` on the container. With no in-flow
  content (the canvas sits inside `position: absolute` panes), the element
  collapses to `height: auto` = **0 px**.
- MapLibre measures the container once at construction. On the tested
  Android profile it captured a stale 300 px height, and since the
  container's height never changes afterwards (it is *permanently* 0 in
  the cascade), no resize event ever fires — the canvas stays pinned to a
  wrong size, the rest of the map area is blank (device-dependent
  degeneration — 0 px, a partial strip, etc.).
- macOS Safari dev was unaffected because Safari uses the WebGL-free
  **Leaflet** renderer (webglSupported() && !isSafari() gate) whose
  vendor CSS does not force `position` on the container.

Secondary (benign) finding: on some headless/mobile profiles the OSM raster
loads get cancelled (ERR_ABORTED) while the viewport re-fits (bounds-fit at
construction + resize reconcile + campus fit) — superseded in-flight tile
requests. 0 HTTP errors; tiles that complete paint normally; the app's
tile-failure banner never triggers.

## C. Evidence

Production app, driven via headless Chrome (playwright-core) with a real
JWT, viewport 390×844, DPR 2.625, Android UA:

```
BEFORE                                 AFTER
.container .maplibregl-map              .maplibregl-map
computed position: relative  (!!)       position: absolute, inset 0
clientHeight: 0                         clientHeight: 728
canvas CSS: 390px x 300px (stale)       canvas CSS: 390px x 728px
canvas buffer: 1023 x 787               canvas buffer: 1023 x 1911
tiles delivered: 0 x HTTP 200           27 x HTTP 200  (glError 0)
DOM dump: cls="absolute inset-0 maplibregl-map"  pos="relative"  h=0
```

Intervention test (same page, injected stylesheet):
`.maplibregl-map { position: absolute !important; inset: 0 !important }`
→ container flips to `position: absolute` and `clientHeight` becomes
728 px. Causal mechanism proven.

## D. Browser/device differences discovered

| Browser | Renderer chosen | Behavior |
|---|---|---|
| macOS Safari (dev) | Leaflet (WebGL-free) | worked — Leaflet css does not force position on the container |
| macOS Chrome desktop | MapLibre | worked by luck — container measured correctly at construction |
| Windows Chrome/Edge | MapLibre | **broken** — container collapsed to 0 px height (blank map) |
| Android Chrome | MapLibre | **broken** — stale 300 px canvas, 428 px dead strip below the map |
| GPU-disabled/software WebGL | Leaflet (webglSupported probe) | works — validated again (0 failures, tiles paint) |

## E. Files changed

- `frontend/src/index.css` — added explicit `.absolute.inset-0.maplibregl-map { position: absolute; inset: 0 }` in the existing "MapLibre overrides" section (higher specificity than the vendor rule).
- `frontend/src/features/map/MapCanvas.tsx` (earlier in this change set) — ResizeObserver-driven `m.resize()` coalesced through one rAF per frame, plus a mount-time size reconcile; DEV-only structured map diagnostics (tree-shaken from production bundles).

## F. Exact fix

1. Pin the map container fill in `index.css`:
   ```css
   .absolute.inset-0.maplibregl-map { position: absolute; inset: 0; }
   ```
   (unlayered, 3-class specificity → beats `.maplibregl-map` (1 class)).
2. Keep the container under a ResizeObserver so every real size change
   (URL-bar collapse, orientation, panel animation) re-measures the map —
   coalesced to one `resize()` per frame, never a loop.

## G. Environment variables checked

- `VITE_API_URL` — Vercel Production target = `https://campusnav-api.onrender.com`; baked at build time (`src/lib/apiBase.ts`). No keys needed for the map (OSM raster, no token).
- No VITE_* vars affect the map beyond the API base; no secrets exposed. Vite env substitution is build-time only (verified in the deployed bundle).

## H. Vercel configuration checked

- Root Directory: `frontend` · Install: `npm install` · Build: `npm run build` (`tsc -b && vite build`) · Output: `dist`.
- Production deploy now flows through the GitHub integration (push → Vercel deploy → alias) — commit `0d14689` is the current production deployment.
- Deployed bundle verified free of `localhost`/`127.0.0.1`; served assets match the locally built output (chunk-level content comparison).

## I. WebGL status

PASS. WebGL2 probe `webglSupported()` gates the MapLibre branch; context
creation + MapLibre rendering verified live on desktop and Android profiles
(`glGetError: 0`). Software-GPU/blocked cases degrade to the webgl-free
Leaflet renderer (verified: renders, 0 failures). Context-loss listeners +
error-path fallback already in place. WebGL is never disabled.

## J. Map container sizing status

PASS (was FAIL). Container is now genuinely `position: absolute; inset: 0`
with real non-zero dimensions at construction and under ResizeObserver
thereafter. Measured: 390×728 (Android profile) and 1142×712 (desktop),
canvas matches container in both.

## K. Tile/style request status

PASS. Style is inline JSON (no style request). Tiles: `https://a|b|c.tile.openstreetmap.org/{z}/{x}/{y}.png` all HTTPS, 200-reachable; ~27–58 tiles delivered per profile with 0 HTTP errors. Glyphs (`demotiles.maplibre.org`, HTTPS) return 200. No 401/403/404/mixed-content/CORS issues.

## L. Tests executed

- Backend: `python -m pytest -q` → **129 passed**.
- Frontend: `npx vitest run` → **50 passed (5 files)**.
- TypeScript: `npx tsc -b` → pass.
- Production build: `npm run build` → `✓ built` (tsc + vite).
- Browser matrix (headless Chrome, live production): desktop Chrome profile, Android 390×844 profile, software-GPU profile — container/canvas equality, HTTP 200 tiles, WebGL errors 0.

## M. Production build result

PASS. `tsc -b && vite build` green locally and on Vercel (deployments for
commits `13753b4` and `0d14689`: READY). Production live at
https://campusnav-v2.vercel.app serving the fixed bundle (index-*.js
hash `BGKsc32s`).

## N. Cross-device verification

| Target | Result |
|---|---|
| macOS Safari | PASS (Leaflet renderer; unchanged, previously working) |
| macOS Chrome | PASS (MapLibre; container 1142×712, tiles 200) |
| Windows Chrome (desktop profile) | PASS via 1366×768 Chrome profile (canvas == container, glError 0) |
| Windows Edge | UNVERIFIED on physical hardware (same engine as Chrome — covered by the Chrome profile) |
| Android Chrome (390×844, DPR 2.625) | PASS via Pixel-8 profile (canvas 390×728, 27 tiles 200) |
| Mobile/tablet viewport | PASS via viewport emulations; layout is derived from CSS flex + absolute fill (no fragile vh units) |
| GPU-restricted / software WebGL | PASS (Leaflet fallback, 0 failures) |

Physical Windows/Android devices were NOT available in this workspace —
all device verification is headless-Chrome emulation of those environments.

## O. Remaining limitations

1. **Physical-device verification pending**: confirm on a real Windows
   laptop and an Android phone (map visible, pan/pinch/rotate, live GPS).
2. **OSM raster tiles** are rate-throttled by the OSM public tile policy —
   heavy zooming can hit transient tile load cancellations (superseded
   in-flight requests are normal; the app banner only appears after real,
   repeated tile errors, and a manual retry exists).
3. **Glyphs** load from the maplibre demo host (`demotiles.maplibre.org`);
   if that demo fixture ever fails, labels degrade but the map raster,
   routes, markers and navigation remain functional.
4. WebGL2-only: genuinely WebGL2-less browsers (very old Android Chrome)
   get the Leaflet renderer, not MapLibre — by design.