# CampusNav — 360° Viewer Upgrade Report

Date: 16 Aug 2026 · Companion: `360-VIEWER-REPORT.md` (previous session, backend/media layer)

## Executive summary

The product 360° experience was upgraded on three fronts — viewer robustness/UX,
a dev-only diagnostic harness, and map-side discovery/navigation — and verified
end-to-end (26/26 automated checks green). During verification the seam
forensics from the earlier session were re-run against the live tile relay and
**must be corrected**: the source cube imagery is not uniformly seam-clean. The
renderer's basis and tile-assembly order were re-confirmed by three independent
methods; the residual weak seams are provider content (up/down captures and
per-tile re-encodes), not an app defect.

Verdicts: **renderer basis — correct** · **L1 assembly grid — correct** ·
**seam defects — content-side, quantified below** · **diagnostic harness —
honest** · **tests/build/E2E — green**.

## 1. What was delivered

### 1.1 Viewer (`CubePanorama.tsx`, `ImmersiveViewer.tsx`)
- HUD: location chip (place label + 360° badge), quality chip, hint line that
  repositions when the scene rail is present, control cluster (Zoom − / +,
  Recenter view, Fullscreen), scene-rail position "n of m" with prev/next.
- Lazy deep-quality up/down faces: u/d L0 (2048²) tiles are skipped until the
  user pitches beyond 38° (set on pointer-drag, wheel, and VR orientation);
  an 8 s deadline forces them in, so a slow tile relay never leaves the top or
  bottom permanently blurry. Horizontal faces always stream 2 → 1 → 0.
- Resize hardening: window-resize + fullscreenchange listeners plus a 500 ms
  ready-race so the drawing buffer stays 1:1 with layout (previously the cube
  could render stretched after the mobile URL bar collapsed).
- Scene rail: any immersive place on campus, cyclic, with "Navigate here"
  routing to the switched node.

### 1.2 Diagnostic harness (`/dev/360-test`, dev-only)
- Seven scene selector, diagnostic cube (CUBE_FACES basis, double-sided,
  OrbitControls, R/L/U/D/F/B sprites inside + outside, turntable, wireframe),
  per-face level chips, live renderer stats (canvas/buffer/aspect/fov/cam),
  and an in-browser seam check: all 12 cube edges × 64 symmetry combos,
  max forward/reverse parity — the forensic method, ported verbatim.
- Verdict chips: green "12/12 seams ≥ 0.9 — basis verified" or amber
  "content is defective: faces … implied conflicting transforms" /
  "N seams below 0.9 — possible wrong basis".
- Excluded from the production bundle: the route returns the SPA shell in
  prod builds and no diagnostic chunk ships (verified).

### 1.3 Map visuals + navigation wiring
- MapLibre: data-driven node circles (kind colors, 360° halo), "360°" badges
  (always visible even with the debug-graph toggle off), node-kind labels,
  and a pulsing amber halo on the next junction of the active route.
- Leaflet fallback: same kind colors + 360° ring on markers, minor-kinds fade
  below zoom 15, next-junction pulse.
- Details sheet: rail prev/next, scene position chip, "Navigate here" routes
  to the other node (`onNavigateToNode`).

## 2. Seam forensics — corrected and re-verified

The earlier session's claim ("all 12 edges ≥ 0.99, basis verified; only
Men's Hostel defective") is **withdrawn**. A full re-run of the original
`seamforensic.js` method (unchanged file, level-2 single tiles, direct via
the backend) against the current relay gives:

| scene        | ring seams (f·r·l·b) min→max | u/d seams min→max | implied transforms |
|--------------|------------------------------|-------------------|--------------------|
| tech_park    | 0.898–0.985                  | 0.443–0.994       | ring identity-consistent; d scattered |
| auditorium   | 0.600–0.952                  | 0.369–0.987       | ring identity; d scattered |
| boys_hostel  | 0.797–0.932                  | 0.239–0.979       | scattered everywhere |
| central_library | 0.424–0.853               | 0.587–0.896       | scattered |
| main_gate    | 0.672–0.869                  | 0.449–0.946       | scattered |
| univ_building| 0.567–0.832                  | 0.443–0.995       | scattered |
| hitech_block | 0.632–0.904                  | 0.460–0.961       | scattered |

At level 1 (assembled 2×2 tiles) every scene collapses to mean ≈ 0.69
(min 0.378–0.581), i.e. seams score worse on the multi-tile pyramid level
than on the single-tile level for the same faces.

**Interpretation — three independent methods agree the app is right and the
content is the defect:**

1. *Assembly order.* Whole-face correlation of L1-as-assembled vs L2
   downscale: 0.985–0.994 for every face of three scenes — the 2×2 grid and
   `r_c = row_col` reading are exactly correct.
2. *Quadrant localization.* Each L1 tile was matched to the L2 quadrants
   (32² blocks, all four tiles, two scenes): `0_0→q0, 1_0→q2, 0_1→q1,
   1_1→q3`, r ≥ 0.87 — the provider's grid is row-major, matching the app
   (`CubemapTileLoader`: drawImage at `row*512, col*512`). A transposed app
   would have scored ~0.6–0.7, not 0.985.
3. *Basis.* The horizon (identity) basis is corroborated exactly where the
   content is well-behaved (tech_park, auditorium ring seams identity +
   0.84–0.99). No single alternative transform set explains any scene's
   full seam set — the scattered implied transforms mean the provider's up/
   down captures drift relative to the horizon (typical of stitched panos).

Net: seam breaks are 1–2 px source-content discontinuities, worst at the
u/d boundaries and worse at pyramid level 1 (each tile was independently
re-encoded). The renderer cannot fix these and should not change basis.

## 3. E2E verification (`verify-360.js`, 26/26)

Prod-gating, diagnostics (render, 7 scenes, deep faces, 12 seam chips +
honest verdict, live stats, buffer sizing, scene switching), auth gate
(register → login → /map), viewer (canvas sized ≥200px, non-blank frames
via clip screenshot 398 KB, HUD chips/controls, drag-look yaw 0°→34°,
wheel fov 75°→62°, scene rail, navigate-here → other node destination,
resize 414→390 keeps buffer 1:1, Escape closes), zero uncaught page errors.
Screenshots: `diag360_default.png`, `diag360_scene2.png`,
`viewer_360_hud.png`, `viewer_360_scene2.png`, `viewer_frame_clip.png`.

Note: the suite drives the mobile path on purpose — the map's place details
live in the BottomSheet, whose full-viewport backdrop covers the desktop
card (see §5.2).

## 4. Tests & build

- Frontend: 37/37 (`immersive.test.ts` + nodeId/lat/lng + rail order).
- Backend: 113/113 (unchanged, re-run for the record).
- `npm run build`: clean, Debug360 absent from dist; three/maplibre chunk
  warnings are pre-existing.

## 5. Issues found during verification and fixed

1. **Login render-time navigation** (`Login.tsx`): `navigate()` during
   render (React "cannot update during render" warning) → moved into a
   `useEffect`; zero page errors now.
2. **`isolate.js` double luminance conversion** and **comparison-length
   mismatch** in the probe scripts (explained the fake 0.000 localization);
   fixed, results in §2 rely on the corrected math.
3. **`seamlevels.js` numbers (min 0.699 for central_library L2) are
   superseded** — the script's downscale path diverged from the forensic
   method; `seamforensic.js` re-run + `isolate.js` agree (min 0.424).

## 5.2 Known issue, not fixed (pre-existing, out of scope)

The map's `BottomSheet` (place details) mounts a full-viewport backdrop
(z-50) whenever a place is selected — on desktop layouts it sits above the
desktop details card (z-20) and swallows clicks on it. Desktop users
effectively get the mobile sheet. Recommend a separate `md:hidden` on the
backdrop/sheet in a future pass; the E2E opens the viewer through the sheet,
which is the current working path.

## 6. Follow-ups

- ✅ Done: `verify-360.js`, `seamforensic.js`, `isolate.js` and `tileorder.js`
  are vendored in `scripts/verify-360/` (with `README.md`; needs
  `puppeteer-core` + Chrome + both servers).
- Provider follow-up: re-export u/d cube faces from the same capture session
  as the horizon, and rebuild L1 tiles from the L2 master (no independent
  re-encode) — would lift L1 seams to L2 levels.

## Files changed

`frontend/src/lib/navigation-types.ts` · `frontend/src/lib/immersive.ts` ·
`frontend/src/lib/immersive.test.ts` · `frontend/src/features/immersive/cubemap.ts`
(reference only) · `frontend/src/features/immersive/CubePanorama.tsx` ·
`frontend/src/features/immersive/ImmersiveViewer.tsx` ·
`frontend/src/features/map/BuildingDetails.tsx` · `frontend/src/pages/MapView.tsx` ·
`frontend/src/pages/Debug360.tsx` (new) · `frontend/src/App.tsx` ·
`frontend/src/features/map/mapStyle.ts` · `frontend/src/features/map/useGraphSources.ts` ·
`frontend/src/features/map/useRouteLayer.ts` · `frontend/src/features/map/LeafletCanvas.tsx` ·
`frontend/src/pages/Login.tsx`.